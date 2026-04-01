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

        console.log('=== OPERATION ===', operation);

        // LOGIN
        if (operation === 'login') {
            try {
                const token = crypto.randomBytes(32).toString('hex');
                const expiresAt = new Date();
                expiresAt.setHours(expiresAt.getHours() + 24);
                
                await supabase
                    .from('admin_sessions')
                    .insert({
                        token: token,
                        expires_at: expiresAt.toISOString()
                    });
                
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ success: true, token: token })
                };
            } catch (dbError) {
                console.error('Login DB error:', dbError);
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ success: true, token: 'debug-token-' + Date.now() })
                };
            }
        }

        // GET STATS
        if (operation === 'get_stats') {
            console.log('Fetching stats...');
            const [ordersCount, revenue, productsCount, customersCount] = await Promise.all([
                supabase.from('orders').select('*', { count: 'exact', head: true }),
                supabase.from('orders').select('total_amount').eq('payment_status', 'success'),
                supabase.from('products').select('*', { count: 'exact', head: true }),
                supabase.from('customers').select('*', { count: 'exact', head: true })
            ]);
            
            console.log('Products count:', productsCount.count);
            
            const totalRevenue = revenue.data?.reduce((sum, o) => sum + (o.total_amount || 0), 0) || 0;
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    totalRevenue: totalRevenue,
                    totalOrders: ordersCount.count || 0,
                    totalProducts: productsCount.count || 0,
                    totalCustomers: customersCount.count || 0
                })
            };
        }

        // GET PRODUCTS - with debug logging
        if (operation === 'get_products') {
            console.log('Fetching products from Supabase...');
            console.log('Supabase URL:', process.env.VITE_SUPABASE_URL ? 'Set' : 'Missing');
            
            const { data: products, error: productsError } = await supabase
                .from('products')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (productsError) {
                console.error('Products error:', productsError);
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: productsError.message })
                };
            }
            
            console.log('Products found:', products?.length || 0);
            if (products?.length > 0) {
                console.log('First product:', products[0].title);
            }
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(products || [])
            };
        }

        // CREATE PRODUCT
        if (operation === 'create_product') {
            console.log('Creating product:', data.title);
            const productId = 'prod_' + Date.now();
            const { data: newProduct, error: createError } = await supabase
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
            
            if (createError) {
                console.error('Create product error:', createError);
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: createError.message })
                };
            }
            
            console.log('Product created:', newProduct.title);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(newProduct)
            };
        }

        // UPDATE PRODUCT
        if (operation === 'update_product') {
            const { data: updatedProduct, error: updateError } = await supabase
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
            
            if (updateError) {
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: updateError.message })
                };
            }
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(updatedProduct)
            };
        }

        // DELETE PRODUCT
        if (operation === 'delete_product') {
            await supabase
                .from('products')
                .update({ is_active: false })
                .eq('id', data.id);
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true })
            };
        }

        // GET ORDERS
        if (operation === 'get_orders') {
            const { data: orders } = await supabase
                .from('orders')
                .select('*')
                .order('created_at', { ascending: false });
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(orders || [])
            };
        }

        // UPDATE ORDER STATUS
        if (operation === 'update_order_status') {
            await supabase
                .from('orders')
                .update({ order_status: data.status })
                .eq('id', data.id);
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true })
            };
        }

        // GET CUSTOMERS
        if (operation === 'get_customers') {
            const { data: customers } = await supabase
                .from('customers')
                .select('*')
                .order('total_spent', { ascending: false });
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(customers || [])
            };
        }

        // GET RECENT ORDERS
        if (operation === 'get_recent_orders') {
            const { data: recent } = await supabase
                .from('orders')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(5);
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(recent || [])
            };
        }

        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Invalid operation: ' + operation })
        };
        
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};
