require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('✅ Servidor Backend OK (Modo Gemini Pro).'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// Tu llave Pro de Render se inyecta aquí automáticamente
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

let players = [];
let gameActive = false;
let activeQuestions = [];
let currentQuestionIndex = 0;
let questionStartTime = 0;
let currentTopic = "CULTURA GENERAL";
let currentPrizes = { first: "🍕 1 PIZZA", second: "🍺 2 CERVEZAS", third: "🍟 PAPAS" };

io.on('connection', (socket) => {
  socket.emit('update_players', players);
  socket.emit('update_prizes', currentPrizes);
  socket.emit('update_topic', currentTopic);

  socket.on('update_prizes', (prizes) => { currentPrizes = prizes; io.emit('update_prizes', currentPrizes); });
  socket.on('update_topic', (topic) => { currentTopic = topic; io.emit('update_topic', currentTopic); });

  socket.on('join_game', (userData) => {
    if (players.length < 20 && !gameActive) {
      players.push({ id: socket.id, ...userData, score: 0, answeredCurrentQ: false, eliminated: false });
      io.emit('update_players', players);
    }
  });

  socket.on('kick_player', (playerId) => {
    players = players.filter(p => p.id !== playerId);
    io.emit('update_players', players);
    io.to(playerId).emit('kicked');
  });

  socket.on('generate_questions', async (topic) => {
    try {
      // 🔥 AHORA SÍ: El código pide explícitamente el modelo PRO
      const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-pro",
        generationConfig: { 
          temperature: 0.2, 
          responseMimeType: "application/json" 
        } 
      });

      const prompt = `Eres un experto en trivias y un historiador riguroso. Tu tarea es generar 10 preguntas desafiantes y ESTRICTAMENTE VERIFICADAS sobre: "${topic}".
            
      REGLAS DE ORO:
      1. NO INVENTES DATOS. Usa hechos históricos comprobables. Si tienes dudas de una fecha o dato, elige otra pregunta.
      2. FORMATO EXACTO: El valor de "correct" DEBE ser exactamente idéntico a uno de los strings dentro del arreglo "options".
      3. CERO PREFIJOS: Prohibido usar "A)", "B:", "C: ". Solo devuelve el texto de la opción limpia.
      4. VARIEDAD: Genera preguntas totalmente nuevas. (Código de sesión único: ${Date.now()})

      ESTRUCTURA JSON REQUERIDA:
      {
        "preguntas": [
          {
            "q": "¿En qué año se fundó el Club de Fútbol Monterrey (Rayados)?", 
            "options": ["1945", "1905", "1960", "1950"], 
            "correct": "1945"
          }
        ]
      }`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      
      const cleanContent = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(cleanContent);
      
      const preguntasExactas = parsedData.preguntas.slice(0, 10);
      
      socket.emit('questions_ready', preguntasExactas);
    } catch (error) { 
      console.error("Error generando preguntas con Gemini Pro:", error);
      socket.emit('questions_error'); 
    }
  });

  socket.on('start_game', (questions) => {
    gameActive = true; activeQuestions = questions; currentQuestionIndex = 0;
    players.forEach(p => { p.score = 0; p.answeredCurrentQ = false; p.eliminated = false; });
    io.emit('game_started', questions);
    io.emit('initial_pause');
    setTimeout(() => { questionStartTime = Date.now(); io.emit('resume_game'); }, 10000);
  });

  socket.on('sync_question', (index) => {
    currentQuestionIndex = Number(index);
    if (currentQuestionIndex === 5) {
      players.forEach(p => { if (Number(p.score) < 2000) p.eliminated = true; });
      io.emit('update_players', players); io.emit('round_pause');
      setTimeout(() => { questionStartTime = Date.now(); players.forEach(p => p.answeredCurrentQ = false); io.emit('resume_game'); }, 10000);
    } else {
      questionStartTime = Date.now(); players.forEach(p => p.answeredCurrentQ = false);
    }
  });

  socket.on('submit_answer', (answerData) => {
    const player = players.find(p => p.id === socket.id);
    if (player && activeQuestions.length > 0 && !player.answeredCurrentQ && !player.eliminated) {
      player.answeredCurrentQ = true;
      const currentQ = activeQuestions[currentQuestionIndex];
      let selectedOption = typeof answerData === 'number' ? currentQ.options[answerData] : answerData;
      const isCorrect = String(selectedOption).trim().toLowerCase() === String(currentQ.correct).trim().toLowerCase();
      const timeRemaining = Math.max(0, 10 - ((Date.now() - questionStartTime) / 1000)); 

      if (isCorrect) { player.score += 1000 + Math.round((timeRemaining / 10) * 1000); } 
      else { player.score = Math.max(0, player.score - 300); }
      
      socket.emit('answer_result', { isCorrect, selectedOption, correctOption: currentQ.correct, newScore: player.score });
      io.emit('update_players', players);
    }
  });

  socket.on('reset_game', () => {
    players = []; gameActive = false; activeQuestions = []; currentQuestionIndex = 0;
    io.emit('update_players', players); io.emit('game_reset');
  });

  socket.on('disconnect', () => {
    players = players.filter(p => p.id !== socket.id);
    io.emit('update_players', players);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => console.log(`✅ Servidor OK en puerto ${PORT}`));
