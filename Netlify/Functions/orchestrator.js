const fs = require('fs');
const path = require('path');

// --- Función Auxiliar para leer los prompts de forma segura ---
const readPromptFromFile = (fileName) => {
    // Construye la ruta absoluta al directorio de prompts
    const promptDirectory = path.resolve(__dirname, '..', 'Prompt');
    const filePath = path.join(promptDirectory, fileName);
    
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        console.error(`Error al leer el archivo de prompt: ${filePath}`, error);
        throw new Error(`No se pudo encontrar o leer el prompt: ${fileName}`);
    }
};

// --- Función para llamar a la API de Gemini (robusta) ---
const callGeminiAPI = async (prompt, base64Data = null) => {
    const fetch = (await import('node-fetch')).default;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        throw new Error("La clave de API de Gemini no está configurada en las variables de entorno de Netlify.");
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    const parts = [{ text: prompt }];
    if (base64Data) {
        parts.push({ inlineData: { mimeType: "image/jpeg", data: base64Data.split(',')[1] } });
    }

    const payload = { contents: [{ role: "user", parts }] };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok || !data.candidates || data.candidates.length === 0) {
            console.error("Respuesta de error o inesperada de la API de Gemini:", JSON.stringify(data));
            throw new Error(`Error de la API de Gemini: ${data.error?.message || 'Respuesta inválida o sin candidatos.'}`);
        }
        
        const text = data.candidates[0].content.parts[0].text;
        
        // --- Bloque de parseo seguro para asegurar que la respuesta sea un JSON válido ---
        try {
            const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleanText);
        } catch (parseError) {
            console.error("Error al parsear el JSON de la API de Gemini.");
            console.error("Texto recibido de la API que causó el error:", text);
            throw new Error("La respuesta de la IA no es un JSON válido.");
        }

    } catch (error) {
        console.error("Error detallado en callGeminiAPI:", error);
        throw error; // Re-lanzamos el error para que el handler principal lo capture
    }
};

// --- Handler Principal de la Función de Netlify ---
exports.handler = async function (event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    try {
        const { base64Data } = JSON.parse(event.body);
        if (!base64Data) {
            return { statusCode: 400, body: JSON.stringify({ error: 'No se proporcionó la imagen en formato base64.' }) };
        }

        // === PASO 1: AGENTE EXTRACTOR ===
        // Extrae el texto crudo y una descripción visual de la imagen.
        const extractorPrompt = readPromptFromFile('data_extractor.txt');
        const extractedData = await callGeminiAPI(extractorPrompt, base64Data);
        if (!extractedData || extractedData.error) {
            throw new Error(`Fallo en el Agente Extractor: ${extractedData.error || 'No se pudo extraer texto.'}`);
        }
        const { raw_text, visual_description } = extractedData;

        // === PASO 2: AGENTES EXPERTOS EN PARALELO ===
        // Se lanzan las tareas de los expertos de fecha, premio y cuentas simultáneamente para ahorrar tiempo.
        const fechaFormateada = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
        
        const dateInputText = `${readPromptFromFile('date_expert.txt').replace('${fechaFormateada}', fechaFormateada)}\n\n# TEXTO A ANALIZAR:\n${raw_text}`;
        const prizeInputText = `${readPromptFromFile('prize_expert.txt')}\n\n# TEXTO A ANALIZAR:\n${raw_text}\n\n# DESCRIPCIÓN VISUAL A CONSIDERAR:\n${visual_description}`;
        const accountsInputText = `${readPromptFromFile('accounts_expert.txt')}\n\n# TEXTO A ANALIZAR:\n${raw_text}`;

        const [dateResult, prizeResult, accountsResult] = await Promise.all([
            callGeminiAPI(dateInputText),
            callGeminiAPI(prizeInputText),
            callGeminiAPI(accountsInputText)
        ]);

        // === PASO 3: ENSAMBLAJE PARCIAL ===
        // Se combinan los resultados de los expertos.
        const partialResult = {
            ...dateResult,
            ...prizeResult,
            ...accountsResult
        };

        // === PASO 4: AGENTE TASADOR (CONDICIONAL) ===
        // Este agente solo se llama si no se encuentra un precio explícito en el texto.
        let priceResult = { price: null, winner_count: 1, appraisal_notes: "No se encontró valor explícito.", url: null };
        const priceRegex = /(\d{1,5}(?:[.,]\d{1,2})?)\s*€/;
        const priceMatch = raw_text.match(priceRegex);

        if (priceMatch) {
            priceResult.price = priceMatch[1].replace(',', '.') + '€'; // Normalizamos a punto decimal
            priceResult.appraisal_notes = "Valor extraído directamente del texto.";
        } else {
            // Si no hay precio, llamamos al experto tasador.
            let appraiserPrompt = readPromptFromFile('price_appraiser.txt');
            appraiserPrompt = appraiserPrompt.replace('${prize_name}', partialResult.prize);
            appraiserPrompt = appraiserPrompt.replace('${accounts_list}', (partialResult.accounts || []).join(', '));
            priceResult = await callGeminiAPI(appraiserPrompt);
        }

        // === PASO 5: ENSAMBLAJE FINAL ===
        // Se une el resultado de la tasación con el resto de los datos.
        const finalResult = {
            ...partialResult,
            ...priceResult
        };

        // Se devuelve el objeto JSON completo al frontend.
        return {
            statusCode: 200,
            body: JSON.stringify(finalResult)
        };

    } catch (error) {
        console.error("Error fatal en el orquestador:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Error en el procesamiento del pipeline de IA.', 
                details: error.message,
                stack: error.stack // El stack trace es útil para una depuración profunda
            })
        };
    }
};
