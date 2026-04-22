import { createClient } from '@supabase/supabase-js';

export const handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    try {
        const supabase = createClient(
            process.env.VITE_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        let requestBody = {};
        try {
            requestBody = event.body ? JSON.parse(event.body) : {};
        } catch (e) {
            console.error('Parse error:', e);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid request body: ' + e.message })
            };
        }

        console.log('Payment request body:', JSON.stringify(requestBody));

        const { email, name, phone, productId, quantity, shippingMethod, address, city, zip, paymentGateway } = requestBody;

        // Validate required fields
        if (!email || !name || !productId || !quantity) {
            console.error('Missing fields:', { email: !!email, name: !!name, productId: !!productId, quantity: !!quantity });
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing required fields. Need: email, name, productId, quantity' })
            };
        }

        // Get product details from database
        const { data: product, error: productError } = await supabase
            .from('products')
            .select('*')
            .eq('product_id', productId)
            .single();

        if (productError || !product) {
            console.error('Product not found:', productId, productError);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Product not found: ' + productId })
            };
        }

        console.log('Product found:', product.title, 'Price:', product.base_price);

        const items = [{ product_id: productId, quantity: quantity }];
        const isArt = product.type === 'original' || product.base_price > 1000;
        const subtotal = product.base_price * quantity;
        const shipping = isArt ? 0 : (shippingMethod === 'express' ? 15 : 7) * quantity;
        const tax = isArt ? 0 : subtotal * 0.08;
        const total = subtotal + shipping + tax;

        console.log('Calculated total:', total);

        const { data: orderData, error: orderError } = await supabase
            .rpc('create_pending_order', {
                p_customer_email: email,
                p_customer_name: name,
                p_customer_phone: phone || '',
                p_items: JSON.stringify(items),
                p_discount_code: null,
                p_shipping_method: shippingMethod || 'standard',
                p_customer_address: { street: address || '', city: city || '', zip: zip || '' }
            });

        if (orderError || !orderData?.success) {
            console.error('Order creation error:', orderError, orderData);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: orderData?.error || 'Failed to create order' })
            };
        }

        console.log('Order created:', orderData.order_number);

        let paymentResponse;
        const amountInKobo = Math.round(orderData.amount * 100);
        const paystackKey = process.env.PAYSTACK_SECRET_KEY;

        if (!paystackKey) {
            console.error('PAYSTACK_SECRET_KEY not set');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Payment gateway not configured' })
            };
        }

        console.log('Initializing Paystack payment...');

        paymentResponse = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${paystackKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                amount: amountInKobo,
                reference: orderData.order_number,
                callback_url: `${process.env.URL || 'https://' + event.headers.host}/checkout-success.html`,
                metadata: {
                    order_id: orderData.order_id,
                    product_title: product.title
                }
            })
        });

        const paymentData = await paymentResponse.json();

        if (!paymentData.status) {
            console.error('Paystack error:', paymentData);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: paymentData.message || 'Payment gateway error' })
            };
        }

        console.log('Payment initialized, redirect URL:', paymentData.data.authorization_url);

        await supabase
            .from('orders')
            .update({ payment_reference: paymentData.data.reference, payment_method: paymentGateway || 'paystack' })
            .eq('id', orderData.order_id);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                authorization_url: paymentData.data.authorization_url,
                reference: paymentData.data.reference,
                order_number: orderData.order_number
            })
        };

    } catch (error) {
        console.error('Payment error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Payment initialization failed: ' + error.message })
        };
    }
};
