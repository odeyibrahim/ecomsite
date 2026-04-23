// netlify/functions/initialize-payment.js
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;

  // Validate URL format
  console.log('Supabase URL:', supabaseUrl);
  console.log('URL format check:', {
    hasHttps: supabaseUrl?.startsWith('https://'),
    hasSupabaseCo: supabaseUrl?.includes('.supabase.co'),
    length: supabaseUrl?.length
  });

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing configuration');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Configuration error',
        message: 'Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify environment variables.'
      })
    };
  }

  // Validate URL format
  if (!supabaseUrl.startsWith('https://') || !supabaseUrl.includes('.supabase.co')) {
    console.error('Invalid Supabase URL format:', supabaseUrl);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Invalid Supabase URL',
        message: 'SUPABASE_URL must be in format: https://your-project.supabase.co'
      })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { email, name, amount, productId, quantity = 1, items = [] } = body;
    
    console.log('=== PAYMENT INITIALIZATION ===');
    console.log('Email:', email);
    console.log('Amount:', amount);
    
    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email is required' })
      };
    }
    
    if (!amount || amount <= 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Valid amount is required' })
      };
    }
    
    // Create Supabase client with explicit options
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      global: {
        headers: {
          'X-Client-Info': 'netlify-function'
        }
      }
    });
    
    // Test connection first
    console.log('Testing Supabase connection...');
    const { error: testError } = await supabase
      .from('orders')
      .select('count')
      .limit(1);
    
    if (testError) {
      console.error('Supabase connection test failed:', testError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Database connection failed',
          message: 'Cannot connect to Supabase. Please check your SUPABASE_URL and network configuration.',
          details: testError.message
        })
      };
    }
    
    console.log('✅ Supabase connection successful');
    
    // Format items
    let itemsArray = [];
    if (Array.isArray(items) && items.length > 0) {
      itemsArray = items;
    } else if (productId) {
      itemsArray = [{
        product_id: productId,
        quantity: parseInt(quantity) || 1
      }];
    }
    
    console.log('Items:', JSON.stringify(itemsArray));
    
    // Insert order
    const orderData = {
      email: email,
      customer_name: name || email.split('@')[0],
      items: itemsArray,
      total_amount: parseFloat(amount),
      status: 'pending',
      payment_status: 'pending',
      created_at: new Date().toISOString()
    };
    
    console.log('Inserting order...');
    
    const { data: result, error: insertError } = await supabase
      .from('orders')
      .insert(orderData)
      .select('id')
      .single();
    
    if (insertError) {
      console.error('Insert error:', insertError);
      throw new Error(`Database insert failed: ${insertError.message}`);
    }
    
    console.log('✅ Order created:', result.id);
    
    // Process Paystack
    if (paystackSecret) {
      console.log('Initializing Paystack payment...');
      
      const paystackPayload = JSON.stringify({
        email: email,
        amount: Math.round(parseFloat(amount) * 100),
        currency: 'GHS',
        metadata: {
          order_id: result.id,
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
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(paystackPayload)
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
      
      if (paystackResponse.status) {
        console.log('✅ Paystack payment URL created');
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            authorization_url: paystackResponse.data.authorization_url,
            reference: paystackResponse.data.reference,
            order_id: result.id
          })
        };
      } else {
        console.error('Paystack error:', paystackResponse.message);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            order_id: result.id,
            message: 'Order created but payment initialization failed',
            payment_error: paystackResponse.message
          })
        };
      }
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        order_id: result.id,
        message: 'Order created successfully'
      })
    };
    
  } catch (error) {
    console.error('Fatal error:', error);
    console.error('Error stack:', error.stack);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};
