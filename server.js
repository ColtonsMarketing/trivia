require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('✅ Servidor Backend OK.'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let players = [];
let gameActive = false;
let activeQuestions = [];
let currentQuestionIndex = 0;
let questionStartTime = 0;
let currentTopic = "CULTURA GENERAL";
// NUEVO: 3 Premios
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

  // NUEVO: Expulsar Jugador
  socket.on('kick_player', (playerId) => {
    players = players.filter(p => p.id !== playerId);
    io.emit('update_players', players);
    io.to(playerId).emit('kicked'); // Le avisa al celular que lo sacaron
  });

  socket.on('generate_questions', async (topic) => {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini", response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `Eres un motor de trivia. DEVUELVE UN JSON CON EXACTAMENTE 10 PREGUNTAS. Formato: { "preguntas": [ {"q": "Pregunta", "options": ["A", "B", "C", "D"], "correct": "Respuesta Exacta"} ] } IMPORTANTE: "correct" DEBE ser el texto exacto.` },
          { role: "user", content: `Genera 10 preguntas sobre: "${topic}".` }
        ]
      });
      socket.emit('questions_ready', JSON.parse(response.choices[0].message.content).preguntas);
    } catch (error) { socket.emit('questions_error'); }
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

server.listen(process.env.PORT || 3001, '0.0.0.0', () => console.log(`✅ Servidor OK`));
