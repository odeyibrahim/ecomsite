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
        
        console.log('Request:', { email, name, amount, productId, quantity, paymentGateway });

        // Hardcode NGN for testing
const currency = 'NGN';
const amountInKobo = Math.round(total * 100 * 1500); // Convert USD to NGN (1500 rate)

// In the Paystack API call:
body: JSON.stringify({
    email: email,
    amount: amountInKobo,
    currency: 'NGN',  // Force NGN
    reference: reference,
    // ...
})
        
        // Validate required fields
        if (!email || !name || !amount || !productId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing required fields' })
            };
        }
        
        // Get Supabase client
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
        
        if (productError || !product) {
            console.error('Product not found:', productId);
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Product not found' })
            };
        }
        
        console.log('Product found:', product.title, 'Price:', product.base_price);
        
        // Calculate amounts
        const subtotal = product.base_price * quantity;
        const isArt = product.type === 'original' || product.base_price > 1000;
        const shipping = isArt ? 0 : 7 * quantity;
        const tax = isArt ? 0 : subtotal * 0.08;
        const total = subtotal + shipping + tax;
        
        console.log('Total amount:', total);
        
        // Create order in database
        const items = [{ product_id: productId, quantity: quantity }];
        
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
        
        if (orderError || !orderData?.success) {
            console.error('Order creation error:', orderError, orderData);
            // Continue anyway for testing
        }
        
        const reference = orderData?.order_number || 'VG-' + Date.now();
        const amountInKobo = Math.round(total * 100);
        
        // Get Paystack key
        const paystackKey = process.env.PAYSTACK_SECRET_KEY;
        
        if (!paystackKey) {
            console.error('PAYSTACK_SECRET_KEY not configured');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Payment gateway not configured' })
            };
        }
        
        console.log('Calling Paystack API...');
        
        // Initialize Paystack transaction
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
                    customer_name: name,
                    product_id: productId,
                    quantity: quantity,
                    order_id: orderData?.order_id
                }
            })
        });
        
        const paystackData = await paystackResponse.json();
        console.log('Paystack response:', paystackData.status ? 'Success' : 'Failed', paystackData.message);
        
        if (paystackData.status) {
            // Update order with payment reference
            if (orderData?.order_id) {
                await supabase
                    .from('orders')
                    .update({ payment_reference: paystackData.data.reference })
                    .eq('id', orderData.order_id);
            }
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    authorization_url: paystackData.data.authorization_url,
                    reference: paystackData.data.reference,
                    order_number: reference
                })
            };
        } else {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: paystackData.message || 'Payment initialization failed',
                    details: paystackData
                })
            };
        }
        
    } catch (error) {
        console.error('Fatal error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};
