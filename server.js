require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('✅ Servidor Backend OK (Modo GPT-4o Sports Bar Activo).'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let players = [];
let gameActive = false;
let activeQuestions = [];
let currentQuestionIndex = 0;
let questionStartTime = 0;
let currentTopic = "DEPORTES Y CULTURA SPORTS BAR";
let currentPrizes = { first: "🍕 1 PIZZA", second: "🍺 2 CERVEZAS", third: "🍟 PAPAS" };

// Función Fisher-Yates para aleatorizar las opciones
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

io.on('connection', (socket) => {
  socket.emit('update_players', players);
  socket.emit('update_prizes', currentPrizes);
  socket.emit('update_topic', currentTopic);

  socket.on('update_prizes', (prizes) => { currentPrizes = prizes; io.emit('update_prizes', currentPrizes); });
  socket.on('update_topic', (topic) => { currentTopic = topic; io.emit('update_topic', currentTopic); });

  socket.on('join_game', (userData) => {
    // ANTI-FANTASMAS: Reconexión por Nombre + Mesa
    const existingPlayer = players.find(p => p.name === userData.name && p.table === userData.table);
    if (existingPlayer) {
      existingPlayer.id = socket.id;
      io.emit('update_players', players);
    } else if (players.length < 20 && !gameActive) {
      players.push({ id: socket.id, ...userData, score: 0, answeredCurrentQ: false, eliminated: false });
      io.emit('update_players', players);
    }
  });

  socket.on('kick_player', (playerId) => {
    players = players.filter(p => p.id !== playerId);
    io.emit('update_players', players);
    io.to(playerId).emit('kicked');
  });

  // 🔥 GENERACIÓN CON GPT-4o Y PROMPT AGRESIVO DE VERIFICACIÓN
  // 🔥 MOTOR DE GENERACIÓN CON GPT-4o (PROMPT EN INGLÉS - LOCALIZADO MTY)
  socket.on('generate_questions', async (topic) => {
    try {
      const seed = Math.floor(Math.random() * 1000000);
      
      const prompt = `Generate a valid JSON with 10 HIGHLY ACCURATE, FRESH, AND DEEP trivia questions about: "${topic}". 
      IMPORTANT: ALL generated questions and options MUST be written in SPANISH.

      CONTEXT & ATMOSPHERE (EXPERT LEVEL):
      - This trivia is played in a Sports Bar in Monterrey, Mexico. The players are hardcore, highly demanding sports fans who already know all the common trivia.
      - Entropy seed: ${seed}. Use this random seed to force your search into a completely different sub-topic, obscure decade, bizarre anecdote, or highly specific record every single time. Never repeat previous patterns.

      DATA SOURCES & LOCAL FOCUS:
      - Cross-reference multiple reliable sports databases, historical archives, and official records. Do not rely on surface-level knowledge.
      - Whenever the topic is about soccer or general sports, heavily prioritize deep, obscure facts about "Liga MX", "Club Tigres UANL", and "Rayados de Monterrey". 

      GOLDEN RULES (ANTI-CLICHÉ & DOUBLE CHECK):
      1. EXTREME DEPTH: BANNED are the most famous or superficial facts (e.g., who won the first World Cup, basic Messi/Jordan/Brady stats). Only use famous entities if asking about an absurdly obscure detail.
      2. MANDATORY VARIETY: Explore forgotten rules, secondary players, strange streaks, old stadiums, or bizarre historical moments.
      3. STRICT FACT-CHECKING: Double-check every date, name, and stat across multiple sources before generating. If there is any historical controversy or doubt, DISCARD the question entirely.
      4. EXACT FORMAT: The string in "correct" MUST be identical, character by character, to one of the strings inside the "options" array.
      5. NO PREFIXES: Do not use "A)", "B:", "1.", etc. Clean text only.

      REQUIRED JSON STRUCTURE:
      {
        "preguntas": [
          {
            "q": "¿Qué jugador anotó el gol decisivo para Tigres en la final del Apertura 2011, rompiendo una sequía de casi 30 años?", 
            "options": ["Héctor Mancilla", "Damián Álvarez", "Danilinho", "Lucas Lobos"], 
            "correct": "Héctor Mancilla"
          }
        ]
      }`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o", 
        response_format: { type: "json_object" },
        temperature: 0.9, // Creatividad alta combinada con el entropy seed para evitar repeticiones
        messages: [
          { 
            role: "system", 
            content: "You are the ultimate trivia engine for a Sports Bar in Mexico. Your priority is obscure depth, avoiding clichés at all costs, maintaining absolute historical accuracy by cross-referencing multiple sources, and responding EXCLUSIVELY in JSON format. Output content in Spanish." 
          },
          { role: "user", content: prompt }
        ]
      });

      const parsedData = JSON.parse(response.choices[0].message.content);
      
      // Mezclamos las opciones de nuevo para asegurar aleatoriedad en la interfaz
      const preguntasProcesadas = parsedData.preguntas.slice(0, 10).map(q => ({
        ...q,
        options: shuffleArray(q.options)
      }));
      
      socket.emit('questions_ready', preguntasProcesadas);
    } catch (error) { 
      console.error("Error generando preguntas con GPT-4o:", error);
      socket.emit('questions_error'); 
    }
  });
  

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        temperature: 0.7,
        messages: [
          { 
            role: "system", 
            content: "Eres el motor de trivia definitivo para un Sports Bar. Tu prioridad es la precisión histórica absoluta y la verificación de datos duros. Respondes EXCLUSIVAMENTE en JSON." 
          },
          { role: "user", content: prompt }
        ]
      });

      const parsedData = JSON.parse(response.choices[0].message.content);
      
      const preguntasProcesadas = parsedData.preguntas.slice(0, 10).map(q => ({
        ...q,
        options: shuffleArray(q.options)
      }));
      
      socket.emit('questions_ready', preguntasProcesadas);
    } catch (error) { 
      console.error("Error generando preguntas con GPT-4o:", error);
      socket.emit('questions_error'); 
    }
  });

  socket.on('start_game', (questions) => {
    gameActive = true; 
    activeQuestions = questions; 
    currentQuestionIndex = 0;
    players.forEach(p => { p.score = 0; p.answeredCurrentQ = false; p.eliminated = false; });
    io.emit('game_started', questions);
    io.emit('initial_pause');
    setTimeout(() => { questionStartTime = Date.now(); io.emit('resume_game'); }, 10000);
  });

  // 🔥 SINCRONIZADOR GLOBAL REFORZADO
  socket.on('sync_question', (index) => {
    currentQuestionIndex = Number(index);
    
    // Transmitimos a TODOS los celulares la nueva pregunta recibida desde la pantalla
    io.emit('sync_question', currentQuestionIndex);

    if (currentQuestionIndex === 5) {
      players.forEach(p => { 
        if (Number(p.score) < 2000) {
          p.eliminated = true; 
        }
      });
      io.emit('update_players', players); 
      io.emit('round_pause');
      setTimeout(() => { 
        questionStartTime = Date.now(); 
        players.forEach(p => p.answeredCurrentQ = false); 
        io.emit('resume_game'); 
      }, 10000);
    } else {
      questionStartTime = Date.now(); 
      players.forEach(p => p.answeredCurrentQ = false);
    }
  });

  socket.on('submit_answer', (answerData) => {
    const targetPlayer = players.find(p => p.id === socket.id) || players.find(p => p.name === answerData.name && p.table === answerData.table);

    if (targetPlayer && activeQuestions.length > 0 && !targetPlayer.answeredCurrentQ && !targetPlayer.eliminated) {
      targetPlayer.answeredCurrentQ = true;
      const currentQ = activeQuestions[currentQuestionIndex];
      
      let selectedOption = typeof answerData === 'object' ? answerData.opt : answerData;
      
      const isCorrect = String(selectedOption).trim().toLowerCase() === String(currentQ.correct).trim().toLowerCase();
      const timeRemaining = Math.max(0, 10 - ((Date.now() - questionStartTime) / 1000)); 

      if (isCorrect) { 
        targetPlayer.score += 1000 + Math.round((timeRemaining / 10) * 1000); 
      } else { 
        targetPlayer.score = Math.max(0, targetPlayer.score - 300); 
      }
      
      socket.emit('answer_result', { isCorrect, selectedOption, correctOption: currentQ.correct, newScore: targetPlayer.score });
      io.emit('update_players', players);
    }
  });

  socket.on('reset_game', () => {
    players = []; gameActive = false; activeQuestions = []; currentQuestionIndex = 0;
    io.emit('update_players', players); io.emit('game_reset');
  });

  socket.on('disconnect', () => {
    if (!gameActive) {
      players = players.filter(p => p.id !== socket.id);
      io.emit('update_players', players);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => console.log(`✅ Servidor OK en puerto ${PORT}`));
