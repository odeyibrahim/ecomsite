import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export const handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
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
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid request body' })
            };
        }

        const adminToken = event.headers['x-admin-token'];
        const { operation, data } = requestBody;

        console.log('=== DEBUG ===');
        console.log('Operation:', operation);
        console.log('Has token:', !!adminToken);
        if (adminToken) console.log('Token first 20 chars:', adminToken.substring(0, 20));

        // LOGIN - always succeeds
        if (operation === 'login') {
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24);
            
            console.log('Creating token:', token.substring(0, 20));
            
            const { data: insertData, error: insertError } = await supabase
                .from('admin_sessions')
                .insert({
                    token: token,
                    expires_at: expiresAt.toISOString()
                })
                .select();
            
            if (insertError) {
                console.error('Insert error:', insertError);
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: 'Failed to create session: ' + insertError.message })
                };
            }
            
            console.log('Insert successful, session created');
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true, token: token })
            };
        }

        // All other operations - verify token
        if (!adminToken) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'No token provided' })
            };
        }

        // Check if token exists in database
        console.log('Looking for token in database...');
        const { data: session, error: sessionError } = await supabase
            .from('admin_sessions')
            .select('*')
            .eq('token', adminToken)
            .single();

        if (sessionError) {
            console.log('Session query error:', sessionError);
        }
        
        if (!session) {
            console.log('No session found for token');
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Invalid or expired token' })
            };
        }

        console.log('Session found, expires:', session.expires_at);
        console.log('Current time:', new Date().toISOString());

        if (new Date(session.expires_at) < new Date()) {
            console.log('Token expired');
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Token expired' })
            };
        }

        console.log('Token valid, processing operation:', operation);

        let result;

        switch (operation) {
            case 'get_stats':
                const [ordersCount, revenue, productsCount, customersCount] = await Promise.all([
                    supabase.from('orders').select('*', { count: 'exact', head: true }),
                    supabase.from('orders').select('total_amount').eq('payment_status', 'success'),
                    supabase.from('products').select('*', { count: 'exact', head: true }),
                    supabase.from('customers').select('*', { count: 'exact', head: true })
                ]);
                
                const totalRevenue = revenue.data?.reduce((sum, o) => sum + (o.total_amount || 0), 0) || 0;
                
                result = {
                    totalRevenue: totalRevenue,
                    totalOrders: ordersCount.count || 0,
                    totalProducts: productsCount.count || 0,
                    totalCustomers: customersCount.count || 0
                };
                break;

            case 'get_products':
                const { data: products } = await supabase
                    .from('products')
                    .select('*')
                    .order('created_at', { ascending: false });
                result = products || [];
                break;

            case 'create_product':
                const productId = 'prod_' + Date.now();
                const { data: newProduct } = await supabase
                    .from('products')
                    .insert({
                        product_id: productId,
                        title: data.title,
                        author: data.author || 'V.',
                        description: data.description || '',
                        type: data.type || 'merch',
                        base_price: parseFloat(data.base_price),
                        stock: parseInt(data.stock) || 0,
                        orientation: data.orientation || 'square',
                        image_url: data.image_url || '',
                        frame_style: data.frame_style || {}
                    })
                    .select()
                    .single();
                result = newProduct;
                break;

            case 'update_product':
                const { data: updatedProduct } = await supabase
                    .from('products')
                    .update({
                        title: data.title,
                        author: data.author,
                        description: data.description,
                        type: data.type,
                        base_price: parseFloat(data.base_price),
                        stock: parseInt(data.stock),
                        orientation: data.orientation,
                        image_url: data.image_url,
                        frame_style: data.frame_style
                    })
                    .eq('id', data.id)
                    .select()
                    .single();
                result = updatedProduct;
                break;

            case 'delete_product':
                await supabase
                    .from('products')
                    .update({ is_active: false })
                    .eq('id', data.id);
                result = { success: true };
                break;

            case 'get_orders':
                const { data: orders } = await supabase
                    .from('orders')
                    .select('*')
                    .order('created_at', { ascending: false });
                result = orders || [];
                break;

            case 'update_order_status':
                await supabase
                    .from('orders')
                    .update({ order_status: data.status })
                    .eq('id', data.id);
                result = { success: true };
                break;

            case 'get_customers':
                const { data: customers } = await supabase
                    .from('customers')
                    .select('*')
                    .order('total_spent', { ascending: false });
                result = customers || [];
                break;

            case 'get_recent_orders':
                const { data: recent } = await supabase
                    .from('orders')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(5);
                result = recent || [];
                break;

            default:
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Invalid operation: ' + operation })
                };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
        };
    } catch (error) {
        console.error('Admin error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Operation failed: ' + error.message })
        };
    }
};
