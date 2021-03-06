"use strict";

var express = require('express');
var path = require('path');
var session = require('express-session');
var logger = require('morgan');
var bodyParser = require('body-parser');
var mongoose = require('mongoose');
var MongoStore = require('connect-mongo')(session);
var passport = require('passport');
var LocalStrategy = require('passport-local');
var util = require('util');
var flash = require('connect-flash');
var bcrypt = require('bcrypt');
var app = express();

var server = require('http').Server(app);
var io = require('socket.io')(server);

// var FacebookStrategy = require('passport-facebook');

var models = require('./models');
var User = models.User;
var routes = require('./routes');

// Make sure we have all required env vars. If these are missing it can lead
// to confusing, unpredictable errors later.
var REQUIRED_ENV = ['SECRET', 'MONGODB_URI'];
REQUIRED_ENV.forEach(function(el) {
  if (!process.env[el])
    throw new Error("Missing required env var " + el);
});

var IS_DEV = app.get('env') === 'development';

if (IS_DEV) {
  mongoose.set('debug', true);
}

app.use(flash());
app.use(logger(IS_DEV ? 'dev' : 'combined'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(process.env.MONGODB_URI);
var mongoStore = new MongoStore({mongooseConnection: mongoose.connection});
app.use(session({
  secret: process.env.SECRET || 'fake secret',
  store: mongoStore
}));

app.use(passport.initialize());
app.use(passport.session());

io.on('connect', onConnect);

function onConnect(socket){

  // sending to the client
  socket.emit('hello', 'can you hear me?', 1, 2, 'abc');

};

passport.serializeUser(function(user, done) {
  done(null, user._id);
});

passport.deserializeUser(function(id, done) {
  User.findById(id, function(err, user) {
    done(err, user);
  });
});

// passport strategy
passport.use(new LocalStrategy(function(username, password, done) {
  if (! util.isString(username)) {
    done(null, false, {message: 'User must be string.'});
    return;
  }
  // Find the user with the given username
  User.findOne({ username: username }, function (err, user) {
    // if there's an error, finish trying to authenticate (auth failed)
    if (err) {
      console.error(err);
      done(err);
      return;
    }
    // if no user present, auth failed
    if (!user) {
      console.log(user);
      done(null, false, { message: 'Incorrect username.' });
      return;
    }
    // if passwords do not match, auth failed
    bcrypt.compare(password, user.password, function(err, res) {
      // res == true
      if (!res) {
        done(null, false, { message: 'Incorrect password.' });
        return;
      }
      // auth has has succeeded
      done(null, user);
      return;
    });
  });
}));

app.use(routes(passport));

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (IS_DEV) {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.send("Error: " + err.message + "\n" + err);
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.send("Error: " + err.message);
});


//SOCKET STUFF and GAME HANDLER
var Game = require('./game');
var game = new Game();


io.on('connection', function(socket){
  console.log("connected");
  // socket.emit('username', false);

  socket.on('addPlayer', function(data){
    console.log('Player added.');
    var res = game.addPlayer(data.username, data.id);

    socket.emit('newUserAdded', data.username);
    socket.broadcast.emit('newUserAdded', data.username);
  });

  socket.on('startGame', function(data){
    try{
      game.startGame();
      console.log("starting game");
    }catch(e){
      socket.emit('message', 'Cannot start game yet!');
      return console.error(e);
    }
    //Otherwise, emit a start event and broadcast a start event to all clients
    socket.emit('startGame', 'starting game');
    socket.broadcast.emit('start', 'starting game');
  });

  socket.on('getGameBoard', function(data){
    console.log('New board: ');
    console.log(game.board);
    socket.emit('sendGameBoard', game.board);
    socket.broadcast.emit('sendGameBoard', game.board);

  });

  socket.on('insertToken', function(data){
    var colNum = data.colNum;
    var playerId = data.id;
    var playerSymbol;

    try{
      playerSymbol = game.getPlayerSymbol(playerId);
    }catch(e){
      socket.emit('error', e.message);
    }

    try{
      // Will return true if player won the game; false if he hasn't won yet
      var res = game.insertToken(colNum, playerSymbol, playerId);
    }catch(e){
      socket.emit('message', e.message);
      return console.log(e);
    }

    socket.emit('sendGameBoard', game.board);
    socket.broadcast.emit('sendGameBoard', game.board);
    console.log(res);
    console.log(game.board);

    // socket.emit('insertToken', res);
    // if player has won the game
    if(res){
      game.completeGame();
      socket.emit('gameHasEnded', 'The game is now ended.');
      socket.broadcast.emit('gameHasEnded', 'The game is now ended.');
      console.log('WINNER!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
      console.log(game.winner.username);
    }
  });
})



server.listen('3000');
module.exports = {app: app, server: server};
