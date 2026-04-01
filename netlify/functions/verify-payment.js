import { createClient } from '@supabase/supabase-js';

export const handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    };

    try {
        const supabase = createClient(
            process.env.VITE_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        let requestBody = {};
        try {
            requestBody = event.body ? JSON.parse(event.body) : {};
        } catch (e) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid request body' })
            };
        }

        const { reference } = requestBody;
        
        if (!reference) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Reference required' })
            };
        }

        const { data: order } = await supabase
            .from('orders')
            .select('*')
            .eq('payment_reference', reference)
            .single();

        if (!order) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Order not found' })
            };
        }

        if (order.payment_status === 'success') {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ status: 'success', order: order })
            };
        }

        let verification;
        
        if (order.payment_method === 'nomba') {
            const verifyRes = await fetch(`https://api.nomba.com/v1/transactions/verify/${reference}`, {
                headers: { 'Authorization': `Bearer ${process.env.NOMBA_SECRET_KEY}` }
            });
            verification = await verifyRes.json();
        } else {
            const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
                headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
            });
            verification = await verifyRes.json();
        }

        if (verification.data?.status === 'success') {
            const { data: result } = await supabase
                .rpc('complete_order_payment', {
                    p_order_id: order.id,
                    p_payment_reference: reference,
                    p_amount_paid: verification.data.amount / 100,
                    p_payment_method: order.payment_method
                });

            if (result?.success) {
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ status: 'success', order: result })
                };
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ status: 'pending' })
        };

    } catch (error) {
        console.error('Verification error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Verification failed' })
        };
    }
};
