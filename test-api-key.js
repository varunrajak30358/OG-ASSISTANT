// Test Zenmux AI API Key
const API_KEY = 'sk-ai-v1-dbd20e2d1abc0ff4d0a31ea4ebc3c0e762bc6e2d102d837014a644c7c6b02620';

async function testZenmuxAPI() {
  console.log('Testing Zenmux AI API key...\n');
  
  try {
    const response = await fetch('https://zenmux.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'glm/glm-5.2',
        messages: [
          {
            role: 'user',
            content: 'Say "API key is working!" if you can read this.'
          }
        ],
        max_tokens: 50
      })
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Zenmux API Key is VALID!\n');
      console.log('Response:', data.choices[0].message.content);
      console.log('\nAPI Details:');
      console.log('- Model:', data.model);
      console.log('- Usage:', data.usage);
    } else {
      console.log('❌ API Key test FAILED!\n');
      console.log('Status:', response.status);
      console.log('Error:', JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.log('❌ Connection Error:\n');
    console.error(error.message);
  }
}

testZenmuxAPI();
