import Database from 'better-sqlite3';

const dbPath = process.env.APPDATA + '/Antigravity/User/globalStorage/state.vscdb';
const ENDPOINTS = [
    'https://daily-cloudcode-pa.sandbox.googleapis.com',
    'https://cloudcode-pa.googleapis.com'
];

async function main() {
    // Get token from Antigravity DB
    const db = new Database(dbPath, { readonly: true });
    const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = 'antigravityAuthStatus'");
    const row = stmt.get();
    db.close();

    if (!row || !row.value) {
        console.log('No auth status found');
        return;
    }

    const authData = JSON.parse(row.value);
    const token = authData.apiKey;

    console.log('Using token for:', authData.email);

    // First, get project ID via loadCodeAssist
    let projectId = null;
    for (const endpoint of ENDPOINTS) {
        try {
            const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'antigravity/2.5.5 win32/x64',
                    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1'
                },
                body: JSON.stringify({
                    metadata: {
                        ideType: 'IDE_UNSPECIFIED',
                        platform: 'PLATFORM_UNSPECIFIED',
                        pluginType: 'GEMINI'
                    }
                })
            });

            if (response.ok) {
                const data = await response.json();
                projectId = data.cloudaicompanionProject;
                console.log('Discovered project ID:', projectId);
                break;
            }
        } catch (error) {
            console.log('Error getting project:', error.message);
        }
    }

    if (!projectId) {
        console.log('Failed to discover project ID');
        return;
    }

    // Now try to call generateContent
    console.log('\n--- Testing generateContent ---');
    for (const endpoint of ENDPOINTS) {
        console.log(`\nTrying ${endpoint}/v1internal:generateContent...`);
        try {
            const payload = {
                project: projectId,
                model: 'claude-3-5-sonnet-20241022',  // Standard Claude model
                request: {
                    contents: [
                        {
                            role: 'user',
                            parts: [{ text: 'Say hello in one word' }]
                        }
                    ],
                    generationConfig: {
                        maxOutputTokens: 100
                    }
                },
                userAgent: 'antigravity',
                requestId: 'test-' + Date.now()
            };

            console.log('Payload project:', payload.project);
            console.log('Payload model:', payload.model);

            const response = await fetch(`${endpoint}/v1internal:generateContent`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'antigravity/2.5.5 win32/x64',
                    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1'
                },
                body: JSON.stringify(payload)
            });

            console.log('Response status:', response.status);
            const text = await response.text();
            console.log('Response:', text.substring(0, 500));

            if (response.ok) {
                console.log('\n=== SUCCESS! ===');
                break;
            }
        } catch (error) {
            console.log('Error:', error.message);
        }
    }
}

main();
