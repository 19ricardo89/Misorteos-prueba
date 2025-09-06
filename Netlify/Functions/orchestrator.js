const fs = require('fs');
const path = require('path');

// --- INICIO: Prompts Incrustados ---

const PROMPTS = {
  data_extractor: `Actúa como un sistema OCR y de análisis visual altamente preciso. Tu única función es procesar una imagen y devolver la información en formato JSON.

# REGLAS ESTRICTAS:
1.  **Salida Exclusivamente JSON:** Tu respuesta DEBE ser únicamente un objeto JSON válido, sin explicaciones, texto introductorio, ni formato markdown como \`\`\`json.
2.  **Extracción de Texto Crudo (raw_text):**
    * Extrae TODO el texto visible en la imagen, manteniendo la mayor fidelidad posible, incluyendo emojis, saltos de línea y errores tipográficos originales.
    * No corrijas ni interpretes el texto, solo transcríbelo.
3.  **Descripción Visual (visual_description):**
    * Describe de forma concisa pero detallada los elementos visuales clave de la imagen que puedan dar contexto sobre el premio (ej: "una foto de un hotel de lujo en una playa tropical", "un bodegón de productos de maquillaje de alta gama", "una pala de pádel junto a varias pelotas en una pista").

# FORMATO JSON DE SALIDA OBLIGATORIO:
{
  "raw_text": "Todo el texto extraído de la imagen...",
  "visual_description": "Descripción de los elementos visuales clave..."
}`,

  date_expert: `Actúa como un experto en extracción de fechas. Tu única función es analizar el texto proporcionado y devolver la fecha de finalización del sorteo en formato JSON.

# REGLAS ESTRICTAS:
1.  **Salida Exclusivamente JSON:** Tu respuesta DEBE ser únicamente un objeto JSON válido, sin explicaciones, texto introductorio, ni formato markdown como \`\`\`json.
2.  **Análisis de Fecha:**
    * La fecha de referencia actual es: \${fechaFormateada}.
    * Interpreta expresiones relativas a la fecha actual (ej: "mañana", "en 3 días", "próximo lunes").
    * Busca fechas explícitas (ej: "25 de diciembre", "31/12/2024").
    * Si encuentras una hora, anótala en el campo 'ends_at_time'. Si la hora es prioritaria (ej: "finaliza a las 14:00h"), marca 'is_priority_time' como true.
    * Si NO encuentras ninguna fecha o día de finalización, el valor de 'date' DEBE ser \`null\`.

# TEXTO A ANALIZAR:
\${raw_text}

# FORMATO JSON DE SALIDA OBLIGATORIO:
{
  "date": "AAAA-MM-DD" | null,
  "ends_at_time": "HH:MM" | null,
  "is_priority_time": true | false
}`,

  prize_expert: `Actúa como un experto en identificar premios de sorteos. Tu única función es analizar el texto y la descripción visual para definir el premio y su categoría, devolviendo el resultado en formato JSON.

# REGLAS ESTRICTAS:
1.  **Salida Exclusivamente JSON:** Tu respuesta DEBE ser únicamente un objeto JSON válido, sin explicaciones ni formato markdown.
2.  **Definición del Premio (prize):**
    * Identifica el premio principal de la forma más clara y concisa posible.
    * Usa la descripción visual para añadir contexto o emojis relevantes (ej: "Viaje a Roma ✈️", "Pala de pádel Bullpadel 🥎").
3.  **Categorización del Premio (prize_category):**
    * Clasifica el premio en UNA de las siguientes categorías predefinidas. Elige la más específica.
    * Categorías: [viajes-internacionales, viajes-nacionales, escapadas, restauracion, entradas-conciertos, entradas-eventos, parques-tematicos, actividades, telefonia, wearables, gaming, informatica, sonido, imagen, software, componentes, cocina, electrodomesticos, muebles, descanso, decoracion, limpieza, bricolaje, moda-femenina, moda-masculina, calzado-moda, calzado-deportivo, bolsos-mochilas, equipaje-viaje, joyeria-relojes, gafas-accesorios, maquillaje-perfumeria, cuidado-personal, cuidado-capilar, gourmet, supermercado, dulces-snacks, bebidas, padel, futbol, fitness, deportes-varios, frikis, juegos-mesa, libros-comics, papeleria, moda-infantil, juguetes, bebes, mascotas, vales-regalo, otros].
4.  **Confianza (confidence_score):**
    * Estima tu confianza (de 0.0 a 1.0) en que la imagen realmente representa un sorteo.

# TEXTO A ANALIZAR:
\${raw_text}

# DESCRIPCIÓN VISUAL A CONSIDERAR:
\${visual_description}

# FORMATO JSON DE SALIDA OBLIGATORIO:
{
  "prize": "Descripción clara del premio",
  "prize_category": "clave_de_la_categoria",
  "confidence_score": 0.95
}`,

  accounts_expert: `Actúa como un extractor de cuentas de Instagram. Tu única función es encontrar todas las cuentas de usuario mencionadas en el texto y devolverlas en una lista en formato JSON.

# REGLAS ESTRICTAS:
1.  **Salida Exclusivamente JSON:** Tu respuesta DEBE ser únicamente un objeto JSON válido, sin explicaciones ni formato markdown.
2.  **Extracción de Cuentas:**
    * Busca todas las cadenas de texto que empiecen con el símbolo "@".
    * Incluye únicamente las cuentas que parezcan ser relevantes para participar en el sorteo (organizadores, colaboradores).
    * Si no encuentras ninguna cuenta, devuelve una lista vacía \`[]\`.

# TEXTO A ANALIZAR:
\${raw_text}

# FORMATO JSON DE SALIDA OBLIGATORIO:
{
  "accounts": ["@cuenta1", "@cuenta2"]
}`,

  price_appraiser: `Actúa como un experto tasador de premios. Tu función es estimar el valor de un premio basándote en su descripción y las cuentas que lo organizan, y devolverlo en formato JSON.

# REGLAS ESTRICTAS:
1.  **Salida Exclusivamente JSON:** Tu respuesta DEBE ser únicamente un objeto JSON válido, sin explicaciones ni formato markdown.
2.  **Estimación del Valor (price):**
    * Basa tu estimación en el mercado español (euros).
    * Si el premio es monetario (ej: "cheque de 100€"), usa ese valor.
    * Si es un producto, estima su Precio de Venta al Público (PVP) aproximado.
    * Si es una experiencia (viaje, cena), haz una estimación razonable.
    * El formato debe ser un string con el símbolo "€" (ej: "150€"). Si no puedes estimarlo, devuelve \`null\`.
3.  **Cantidad de Ganadores (winner_count):**
    * Determina cuántos ganadores habrá. Si no se especifica, asume que es 1.
4.  **Notas de Tasación (appraisal_notes):**
    * Explica brevemente cómo llegaste a tu estimación (ej: "Valor basado en el PVP de un iPhone 15", "Estimación de una cena para dos personas en un restaurante medio").
5.  **URL (url):**
    * Si es posible, busca una URL de referencia para el producto o una de las cuentas organizadoras. Si no la encuentras, devuelve \`null\`.

# INFORMACIÓN DEL PREMIO:
* **Nombre del Premio:** \${prize_name}
* **Cuentas Organizadoras:** \${accounts_list}

# FORMATO JSON DE SALIDA OBLIGATORIO:
{
  "price": "150€" | null,
  "winner_count": 1,
  "appraisal_notes": "Explicación de la tasación.",
  "url": "https://ejemplo.com/producto" | null
}`
};

// --- FIN: Prompts Incrustados ---


// --- Función para llamar a la API de Gemini (VERSIÓN FINAL CON TODAS LAS CORRECCIONES) ---
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

    const payload = {
        contents: [{ role: "user", parts }],
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok || !data.candidates || data.candidates.length === 0) {
            const blockReason = data.promptFeedback?.blockReason;
            if (blockReason) throw new Error(`Llamada a la API bloqueada por seguridad: ${blockReason}`);
            console.error("Respuesta de error de Gemini:", JSON.stringify(data));
            throw new Error(`Error de la API de Gemini: ${data.error?.message || 'Respuesta inválida.'}`);
        }
        
        const candidate = data.candidates[0];
        
        if (candidate.finishReason && candidate.finishReason !== "STOP") {
             throw new Error(`La IA finalizó por una razón inesperada: ${candidate.finishReason}.`);
        }
        
        if (!candidate.content?.parts?.[0]?.text) {
            console.error("La respuesta de la IA no tiene el formato de texto esperado:", JSON.stringify(candidate));
            throw new Error("La IA devolvió una respuesta vacía o con un formato incorrecto.");
        }

        const text = candidate.content.parts[0].text;

        try {
            return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
        } catch (parseError) {
            console.error("Error al parsear el JSON de la IA. Texto recibido:", text);
            throw new Error("La respuesta de la IA no es un JSON válido.");
        }

    } catch (error) {
        console.error("Error detallado en callGeminiAPI:", error);
        throw error;
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

        const extractorPrompt = PROMPTS.data_extractor;
        const extractedData = await callGeminiAPI(extractorPrompt, base64Data);
        const { raw_text, visual_description } = extractedData;

        const fechaFormateada = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
        
        // --- Preparamos los prompts de los expertos ---
        const dateInputText = PROMPTS.date_expert
            .replace('${fechaFormateada}', fechaFormateada)
            .replace('${raw_text}', raw_text);

        const prizeInputText = PROMPTS.prize_expert
            .replace('${raw_text}', raw_text)
            .replace('${visual_description}', visual_description);

        const accountsInputText = PROMPTS.accounts_expert
            .replace('${raw_text}', raw_text);

        // --- Ejecutamos los expertos en paralelo ---
        const [dateResult, prizeResult, accountsResult] = await Promise.all([
            callGeminiAPI(dateInputText),
            callGeminiAPI(prizeInputText),
            callGeminiAPI(accountsInputText)
        ]);

        const partialResult = { ...dateResult, ...prizeResult, ...accountsResult };

        // --- Agente Tasador (condicional) ---
        let priceResult = { price: null, winner_count: 1, appraisal_notes: "No se encontró valor explícito.", url: null };
        const priceRegex = /(\d{1,5}(?:[.,]\d{1,2})?)\s*€/;
        const priceMatch = raw_text.match(priceRegex);

        if (priceMatch) {
            priceResult.price = priceMatch[1].replace(',', '.') + '€';
            priceResult.appraisal_notes = "Valor extraído directamente del texto.";
        } else {
            let appraiserPrompt = PROMPTS.price_appraiser;
            appraiserPrompt = appraiserPrompt.replace('${prize_name}', partialResult.prize);
            appraiserPrompt = appraiserPrompt.replace('${accounts_list}', (partialResult.accounts || []).join(', '));
            priceResult = await callGeminiAPI(appraiserPrompt);
        }

        // --- Ensamblaje Final ---
        const finalResult = { ...partialResult, ...priceResult };

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
                stack: error.stack
            })
        };
    }
};