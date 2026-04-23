// netlify/functions/initialize-payment.js
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  // Get environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;

  console.log('Environment check:', {
    hasSupabaseUrl: !!supabaseUrl,
    hasSupabaseKey: !!supabaseKey,
    hasPaystackSecret: !!paystackSecret
  });

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase configuration');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Server configuration error',
        message: 'Payment service temporarily unavailable'
      })
    };
  }

  try {
    // Parse request body
    const body = JSON.parse(event.body);
    const { email, name, amount, productId, quantity = 1, items = [] } = body;
    
    console.log('=== PAYMENT INITIALIZATION ===');
    console.log('Request:', { email, name, amount, productId, quantity });
    console.log('Received items type:', typeof items);
    console.log('Received items:', items);
    
    // Initialize Supabase
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // ==============================================
    // OPTION 2: DIRECT DATABASE INSERT (FIX)
    // ==============================================
    console.log('Creating order with direct insert...');
    
    // Convert items to a proper array
    let itemsArray;
    if (Array.isArray(items)) {
      itemsArray = items;
    } else if (typeof items === 'string') {
      try {
        itemsArray = JSON.parse(items);
      } catch (e) {
        itemsArray = [{ product_id: productId, quantity: quantity }];
      }
    } else if (items && typeof items === 'object') {
      itemsArray = [items];
    } else {
      itemsArray = [{ product_id: productId || 'unknown', quantity: quantity }];
    }
    
    console.log('Formatted items array:', JSON.stringify(itemsArray));
    console.log('Is items array?', Array.isArray(itemsArray));
    
    // Insert into orders table
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .insert({
        email: email,
        customer_name: name || email.split('@')[0],
        items: itemsArray,
        total_amount: parseFloat(amount),
        status: 'pending',
        payment_status: 'pending',
        created_at: new Date().toISOString()
      })
      .select();
    
    if (orderError) {
      console.error('Order creation failed:', orderError);
      throw new Error(`Order creation failed: ${orderError.message}`);
    }
    
    console.log('Order created successfully:', orderData);
    
    // Continue with Paystack payment if secret exists
    if (paystackSecret) {
      // Initialize Paystack payment
      const paystackPayload = JSON.stringify({
        email: email,
        amount: Math.round(parseFloat(amount) * 100),
        currency: 'GHS',
        metadata: {
          order_id: orderData[0]?.id,
          customer_email: email
        }
      });
      
      const paystackOptions = {
        hostname: 'api.paystack.co',
        port: 443,
        path: '/transaction/initialize',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json'
        }
      };
      
      const paystackResponse = await new Promise((resolve, reject) => {
        const req = https.request(paystackOptions, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
        req.write(paystackPayload);
        req.end();
      });
      
      if (!paystackResponse.status) {
        console.error('Paystack error:', paystackResponse.message);
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Payment initialization failed',
            message: paystackResponse.message,
            order_created: true,
            order_id: orderData[0]?.id
          })
        };
      }
      
      console.log('Payment initialized successfully');
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          authorization_url: paystackResponse.data.authorization_url,
          reference: paystackResponse.data.reference,
          access_code: paystackResponse.data.access_code,
          order_id: orderData[0]?.id
        })
      };
    }
    
    // Return success even without Paystack (for testing)
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Order created successfully',
        order_id: orderData[0]?.id
      })
    };
    
  } catch (error) {
    console.error('Fatal error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};
