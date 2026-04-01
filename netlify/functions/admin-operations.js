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

        // LOGIN - simple version
        if (operation === 'login') {
            try {
                const token = crypto.randomBytes(32).toString('hex');
                const expiresAt = new Date();
                expiresAt.setHours(expiresAt.getHours() + 24);
                
                // Insert into database
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
                console.error('Database error:', dbError);
                return {
                    statusCode: 200,  // Still return success for testing
                    headers,
                    body: JSON.stringify({ success: true, token: 'debug-token-' + Date.now() })
                };
            }
        }

        // For all other operations, just return mock data for testing
        if (operation === 'get_stats') {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    totalRevenue: 0,
                    totalOrders: 0,
                    totalProducts: 4,
                    totalCustomers: 0
                })
            };
        }

        if (operation === 'get_products') {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify([
                    {
                        id: '1',
                        product_id: 'prod_001',
                        title: 'Archive Tee',
                        base_price: 45,
                        stock: 10,
                        type: 'merch',
                        image_url: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800'
                    },
                    {
                        id: '2',
                        product_id: 'prod_002',
                        title: 'Desert Landscape',
                        base_price: 195,
                        stock: 5,
                        type: 'print',
                        image_url: 'https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=800'
                    }
                ])
            };
        }

        if (operation === 'get_orders') {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify([])
            };
        }

        if (operation === 'get_customers') {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify([])
            };
        }

        if (operation === 'get_recent_orders') {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify([])
            };
        }

        // Default response
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ message: 'Operation not implemented', operation })
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
