require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
  res.send('✅ Servidor Backend de Coltons funcionando correctamente.');
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let players = [];
let gameActive = false;
let activeQuestions = [];
let currentQuestionIndex = 0;
let questionStartTime = 0;
let currentPrize = "🍕 ¡1 PIZZA GRATIS!"; 
let currentTopic = "CULTURA GENERAL"; // Nuevo estado para el tema

io.on('connection', (socket) => {
  console.log(`🔌 Usuario conectado: ${socket.id}`);
  
  socket.emit('update_players', players);
  socket.emit('update_prize', currentPrize);
  socket.emit('update_topic', currentTopic);

  // PUENTES DE ACTUALIZACIÓN
  const handlePrizeUpdate = (newPrize) => {
    currentPrize = newPrize;
    io.emit('update_prize', currentPrize);
  };
  socket.on('set_prize', handlePrizeUpdate);
  socket.on('update_prize', handlePrizeUpdate);

  socket.on('update_topic', (topic) => {
    currentTopic = topic;
    io.emit('update_topic', currentTopic);
  });

  socket.on('join_game', (userData) => {
    if (players.length < 20 && !gameActive) {
      players.push({ id: socket.id, ...userData, score: 0, answeredCurrentQ: false, eliminated: false });
      io.emit('update_players', players);
    }
  });

  socket.on('generate_questions', async (topic) => {
    try {
      // IA GENERARÁ 10 PREGUNTAS AHORA
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { 
            role: "system", 
            content: `Eres el motor de trivia de un casino. DEVUELVE UN JSON CON EXACTAMENTE 10 PREGUNTAS (Para 2 rondas de 5). Dificultad alta.
            Formato exacto:
            {
              "preguntas": [
                {"q": "Pregunta 1", "options": ["A", "B", "C", "D"], "correct": "A"}
                // ... hasta llegar a 10
              ]
            }`
          },
          { role: "user", content: `Genera 10 preguntas sobre: "${topic}".` }
        ]
      });
      
      const result = JSON.parse(response.choices[0].message.content);
      socket.emit('questions_ready', result.preguntas);
    } catch (error) {
      socket.emit('questions_error');
    }
  });

  socket.on('start_game', (questions) => {
    gameActive = true;
    activeQuestions = questions;
    currentQuestionIndex = 0;
    questionStartTime = Date.now();
    
    players.forEach(p => {
      p.score = 0;
      p.answeredCurrentQ = false;
      p.eliminated = false;
    });

    io.emit('game_started', questions);
  });

  socket.on('sync_question', (index) => {
    currentQuestionIndex = index;
    questionStartTime = Date.now(); 
    
    // CORTE DE SUPERVIVENCIA: Al llegar a la pregunta 6 (índice 5), eliminamos a los de menos de 2000 puntos
    if (index === 5) {
      players.forEach(p => {
        if (p.score < 2000) {
          p.eliminated = true;
        }
      });
      io.emit('update_players', players);
    }

    players.forEach(p => p.answeredCurrentQ = false);
  });

  socket.on('submit_answer', (answerData) => {
    const player = players.find(p => p.id === socket.id);
    // Solo permitimos responder si NO está eliminado
    if (player && activeQuestions.length > 0 && !player.answeredCurrentQ && !player.eliminated) {
      player.answeredCurrentQ = true;
      const currentQ = activeQuestions[currentQuestionIndex];

      let selectedOption = typeof answerData === 'number' ? currentQ.options[answerData] : answerData;

      const cleanSelected = String(selectedOption).trim().toLowerCase();
      const cleanCorrect = String(currentQ.correct).trim().toLowerCase();
      const isCorrect = cleanSelected === cleanCorrect;

      const timeTaken = (Date.now() - questionStartTime) / 1000; 
      const timeRemaining = Math.max(0, 10 - timeTaken); 

      if (isCorrect) {
        const speedBonus = Math.round((timeRemaining / 10) * 1000);
        const totalEarned = 1000 + speedBonus;
        player.score += totalEarned;
      } else {
        player.score = Math.max(0, player.score - 300);
      }
      
      socket.emit('answer_result', {
        isCorrect,
        selectedOption,
        correctOption: currentQ.correct,
        newScore: player.score
      });

      io.emit('update_players', players);
    }
  });

  socket.on('reset_game', () => {
    players = [];
    gameActive = false;
    activeQuestions = [];
    currentQuestionIndex = 0;
    io.emit('update_players', players);
    io.emit('game_reset');
  });

  socket.on('disconnect', () => {
    players = players.filter(p => p.id !== socket.id);
    io.emit('update_players', players);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0');
