import { createClient } from '@supabase/supabase-js';

export const handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    };

    try {
        console.log('=== VERIFY PAYMENT CALLED ===');
        console.log('HTTP Method:', event.httpMethod);
        
        // Handle webhook from Paystack
        if (event.httpMethod === 'POST') {
            console.log('Webhook received!');
            console.log('Body:', event.body);
            
            const supabase = createClient(
                process.env.VITE_SUPABASE_URL,
                process.env.SUPABASE_SERVICE_ROLE_KEY
            );
            
            const payload = JSON.parse(event.body);
            console.log('Parsed payload:', JSON.stringify(payload));
            
            if (payload.event === 'charge.success') {
                const { reference, amount, customer, metadata } = payload.data;
                console.log('Successful charge! Reference:', reference);
                console.log('Amount:', amount);
                console.log('Customer:', customer.email);
                console.log('Metadata:', metadata);
                
                // Find order by reference
                const { data: order, error: orderError } = await supabase
                    .from('orders')
                    .select('*')
                    .eq('payment_reference', reference)
                    .single();
                
                if (orderError) {
                    console.log('Order not found by reference, trying order_number...');
                    const { data: orderByNumber, error: numberError } = await supabase
                        .from('orders')
                        .select('*')
                        .eq('order_id', reference)
                        .single();
                    
                    if (numberError) {
                        console.error('Order not found:', numberError);
                        return {
                            statusCode: 404,
                            headers,
                            body: JSON.stringify({ error: 'Order not found' })
                        };
                    }
                    
                    // Update order
                    const { error: updateError } = await supabase
                        .from('orders')
                        .update({
                            payment_status: 'success',
                            payment_reference: reference,
                            paid_at: new Date().toISOString(),
                            order_status: 'processing'
                        })
                        .eq('id', orderByNumber.id);
                    
                    if (updateError) {
                        console.error('Update error:', updateError);
                    } else {
                        console.log('Order updated successfully!');
                    }
                    
                    // Update customer stats
                    await supabase
                        .from('customers')
                        .update({
                            orders_count: supabase.rpc('increment', { x: 1 }),
                            total_spent: supabase.rpc('add', { x: amount / 100 }),
                            last_order_at: new Date().toISOString()
                        })
                        .eq('email', customer.email);
                }
            }
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ status: 'success' })
            };
        }
        
        // Handle GET requests (manual verification)
        if (event.httpMethod === 'GET') {
            const reference = event.queryStringParameters?.reference;
            if (!reference) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Reference required' })
                };
            }
            
            const supabase = createClient(
                process.env.VITE_SUPABASE_URL,
                process.env.SUPABASE_SERVICE_ROLE_KEY
            );
            
            const { data: order } = await supabase
                .from('orders')
                .select('*')
                .eq('payment_reference', reference)
                .single();
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ status: order?.payment_status || 'pending', order })
            };
        }
        
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
        
    } catch (error) {
        console.error('Verification error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};
