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
        console.log('=== PAYMENT INITIALIZATION ===');
        
        const body = JSON.parse(event.body || '{}');
        const { email, name, amount, productId, quantity, paymentGateway } = body;
        
        console.log('Request:', { email, name, amount, productId, quantity });
        
        const supabase = createClient(
            process.env.VITE_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        
        // Get product details
        const { data: product, error: productError } = await supabase
            .from('products')
            .select('*')
            .eq('product_id', productId)
            .single();
        
        if (productError) {
            console.error('Product error:', productError);
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Product not found: ' + productId })
            };
        }
        
        console.log('Product found:', product.title);
        
        // Calculate amounts
        const subtotal = product.base_price * quantity;
        const isArt = product.type === 'original' || product.base_price > 1000;
        const shipping = isArt ? 0 : 7 * quantity;
        const tax = isArt ? 0 : subtotal * 0.08;
        const total = subtotal + shipping + tax;
        
        console.log('Total calculated:', total);
        
        // Create items array for the order
        const items = [{ product_id: productId, quantity: quantity }];
        console.log('Items:', JSON.stringify(items));
        
        // Call the create_pending_order function
        console.log('Calling create_pending_order...');
        const { data: orderData, error: orderError } = await supabase
            .rpc('create_pending_order', {
                p_customer_email: email,
                p_customer_name: name,
                p_customer_phone: '',
                p_items: JSON.stringify(items),
                p_discount_code: null,
                p_shipping_method: 'standard',
                p_customer_address: { street: '', city: '', zip: '' }
            });
        
        if (orderError) {
            console.error('Order RPC error:', orderError);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Order creation failed: ' + orderError.message })
            };
        }
        
        console.log('Order RPC response:', JSON.stringify(orderData));
        
        if (!orderData || !orderData.success) {
            console.error('Order creation failed:', orderData?.error);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: orderData?.error || 'Order creation failed' })
            };
        }
        
        console.log('Order created successfully! Order ID:', orderData.order_number);
        
        // Initialize Paystack
        const paystackKey = process.env.PAYSTACK_SECRET_KEY;
        const reference = orderData.order_number;
        const amountInKobo = Math.round(total * 100);
        
        console.log('Calling Paystack with reference:', reference);
        
        const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${paystackKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                amount: amountInKobo,
                reference: reference,
                callback_url: 'https://strong-ganache-65cc18.netlify.app/checkout-success.html',
                metadata: {
                    order_id: orderData.order_id,
                    product_title: product.title
                }
            })
        });
        
        const paystackData = await paystackResponse.json();
        console.log('Paystack response:', paystackData.status ? 'Success' : 'Failed');
        
        if (!paystackData.status) {
            console.error('Paystack error:', paystackData.message);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: paystackData.message })
            };
        }
        
        // Update order with payment reference
        await supabase
            .from('orders')
            .update({ payment_reference: paystackData.data.reference })
            .eq('id', orderData.order_id);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                authorization_url: paystackData.data.authorization_url,
                reference: paystackData.data.reference,
                order_number: reference
            })
        };
        
    } catch (error) {
        console.error('Fatal error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};
