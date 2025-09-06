const fs = require('fs');
const path = require('path');

// --- Función Auxiliar para leer los prompts de forma segura ---
const readPromptFromFile = (fileName) => {
    // Construye la ruta absoluta al directorio de prompts para evitar problemas
    const promptDirectory = path.resolve(__dirname, '..', 'Prompt');
    const filePath = path.join(promptDirectory, fileName);
    
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        console.error(`Error al leer el archivo de prompt: ${filePath}`, error);
        // Lanza un error claro que será capturado por el handler principal
        throw new Error(`No se pudo encontrar o leer el prompt: ${fileName}`);
    }
};

// --- Función para llamar a la API de Gemini (VERSIÓN ROBUSTA) ---
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

        // Si la respuesta no es OK (ej. 4xx, 5xx) o no contiene candidatos, es un error
        if (!response.ok || !data.candidates || data.candidates.length === 0) {
            // Comprobamos si la IA bloqueó el prompt por seguridad
            const blockReason = data.promptFeedback?.blockReason;
            if (blockReason) {
                throw new Error(`Llamada a la API bloqueada por seguridad: ${blockReason}`);
            }
            console.error("Respuesta de error o inesperada de la API de Gemini:", JSON.stringify(data));
            throw new Error(`Error de la API de Gemini: ${data.error?.message || 'Respuesta inválida o sin candidatos.'}`);
        }
        
        // --- BLOQUE DE VERIFICACIÓN "ANTIFRÁGIL" ---
        // Este bloque comprueba la respuesta ANTES de intentar usarla.
        const candidate = data.candidates[0];
        
        // 1. Verificar si la IA finalizó por una razón que no sea la esperada ("STOP")
        if (candidate.finishReason && candidate.finishReason !== "STOP") {
             throw new Error(`La IA finalizó por una razón inesperada: ${candidate.finishReason}. Esto suele ocurrir por filtros de seguridad internos de la IA.`);
        }
        
        // 2. Verificar que la estructura de la respuesta contenga un texto válido
        if (!candidate.content || !candidate.content.parts || !candidate.content.parts[0] || typeof candidate.content.parts[0].text !== 'string') {
            console.error("La respuesta de la IA no tiene el formato de texto esperado:", JSON.stringify(candidate));
            throw new Error("La respuesta de la IA no contenía un texto válido para procesar.");
        }
        // --- FIN DEL BLOQUE "ANTIFRÁGIL" ---

        const text = candidate.content.parts[0].text;
        
        // Intenta parsear la respuesta como JSON
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