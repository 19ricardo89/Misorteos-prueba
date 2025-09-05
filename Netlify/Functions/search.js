const fs = require('fs');
const path = require('path');

// Función auxiliar para leer el prompt del archivo
const readPromptFromFile = (fileName) => {
    const filePath = path.join(__dirname, `../prompts/${fileName}`);
    return fs.readFileSync(filePath, 'utf8');
};

// Función para llamar a la API de Gemini
const callGeminiAPI = async (prompt) => {
    const fetch = (await import('node-fetch')).default;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error("Error desde la API de Gemini:", await response.text());
            throw new Error(`La API de Gemini devolvió el estado: ${response.status}`);
        }

        const data = await response.json();
        const text = data.candidates[0].content.parts[0].text;
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);

    } catch (error) {
        console.error("Error en callGeminiAPI de search.js:", error);
        return { price: "~0€", appraisal_notes: "Error durante la búsqueda de valor.", url: null, winner_count: 1 };
    }
};

exports.handler = async function (event, context) {
    // El frontend ahora nos enviará un objeto con el nombre del premio y la lista de cuentas
    const { prize_name, accounts_list } = JSON.parse(event.body);
    if (!prize_name) {
        return { statusCode: 400, body: JSON.stringify({ error: 'No se proporcionó nombre del premio.' }) };
    }

    // 1. Leer la plantilla del prompt desde el archivo
    let appraiserPrompt = readPromptFromFile('5_price_appraiser.txt');

    // 2. Inyectar los datos dinámicos en la plantilla
    appraiserPrompt = appraiserPrompt.replace('${prize_name}', prize_name);
    appraiserPrompt = appraiserPrompt.replace('${accounts_list}', accounts_list.join(', '));

    // 3. Llamar a la API con el prompt completo y dinámico
    const result = await callGeminiAPI(appraiserPrompt);

    return {
        statusCode: 200,
        body: JSON.stringify(result)
    };
};