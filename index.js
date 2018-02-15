const express = require("express"),
      app = express(),
      bodyParser = require("body-parser"),
      path = require("path"),
      mysql = require("mysql"),
      { check, validationResult } = require('express-validator/check'),
      http = require("http").createServer(app),
      io = require("socket.io")(http),
      session = require("express-session"),
      MySQLStore = require('express-mysql-session')(session),
      dateFormat = require("dateformat"),
      formidable = require('formidable'),
      fs = require("fs"),
      jimp = require("jimp");

// connect to mysql
const con = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: null,
  database: "node_social_net"
})
con.connect((err) => {
  if(err) throw err;
})

//my SQL session store
const sessionStore = new MySQLStore({}, con);

//View Engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "public"));

// set the static path
app.use(express.static(path.join(__dirname, "public")));

//body parser middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));


// express session
app.use(session({
  resave: true,
  secret: "42",
  saveUninitialized: false,
  store: sessionStore
}));

// rendering and stuff
app.get("/", (req, res) => {
  if(req.session.username) {
    res.redirect("/account/" + req.session.username);
  }
  else{
    res.render("index", {
      activePage: "index"
    });
  }
})

app.get("/signup", (req, res) => {
  if(req.session.username) {
    res.redirect("/account/" + req.session.username);
  }
  else{
    res.render("signup");
  }
})

app.get("/terms", (req, res) => {
  if(req.session.username){
    res.render("terms", {
      currentUser: req.session.userID
    });
  }
  else{
    res.render("terms");
  }
})

app.get("/about", (req, res) => {
  if(req.session.username){
    res.render("about", {
      currentUser: req.session.userID,
      activePage: "about"
    });
  }
  else{
    res.render("about", {
      activePage: "about"
    });
  }
})

app.get("/login", (req, res) => {
  if(req.session.username) {
    res.redirect("/account/" + req.session.username);
  }
  else{
    res.render("login");
  }
})

app.get("/account/:username", (req, res) => {

  //check if the username exists in the database
  con.query("SELECT * FROM users WHERE username = ?", [req.params.username], (err, result) =>{
    if(err) throw err;

    //the username exists
    if(result.length == 1){
      if(req.session.username){
        res.render("account", {
          currentUser: req.session.userID,
          username: result[0].username,
          registrationDate: dateFormat(result[0].registrationDate, "mmm yyyy"),
          bio: result[0].bio,
          isCurrentUser: result[0].username == req.session.username,
          hasProfilePic: result[0].hasProfilePic == 1
        });
      }
      else{
        res.render("account", {
          username: result[0].username,
          registrationDate: dateFormat(result[0].registrationDate, "mmm yyyy"),
          bio: result[0].bio,
          hasProfilePic: result[0].hasProfilePic == 1
        })
      }
    }
  })
})

app.get("/account/:username/edit", (req, res) => {

  //check if the username exists in the database
  con.query("SELECT * FROM users WHERE username = ?", [req.params.username], (err, result) =>{
    if(err) throw err;

    //the username exists and it's the user who is currently logged in
    if(result.length == 1 && req.session.username && req.session.username == result[0].username){
      res.render("account", {
        currentUser: req.session.userID,
        username: result[0].username,
        registrationDate: dateFormat(result[0].registrationDate, "mmm yyyy"),
        bio: result[0].bio,
        isCurrentUser: true,
        editing: true,
        newProfilePic: req.query.newProfilePic
      });
    }
  })
})

// create an account
app.all("/users/newAccount", [
  // express validator
  check("username")
    .exists().withMessage("The username can't be empty")
    .isLength({ min: 8 }).withMessage("The username must be at least 8 characters long"),
  check("email")
    .isEmail().withMessage("The email doesn't look right..."),
  check("password", "The password has to be at least 8 characterss long and contain one number")
    .isLength({ min: 8 })
    .matches(/\d/),
  check("gender")
    .exists().withMessage("Please select your gender"),
  check("terms")
    .equals("on").withMessage("Please click on the checkbox to agree to the terms and conditions")
], (req, res, next) => {
  // Get the validation result whenever you want; see the Validation Result API for all options!
  var validatorErrors = validationResult(req);
  if (!validatorErrors.isEmpty()) {
    res.render("signup", {
      validatorErrors: validatorErrors.mapped(),
      refill: {username: req.body.username, email: req.body.email, gender: req.body.gender, terms: req.body.terms}
    });
    res.end();
  }
  else {
    // stores whether there have been errors
    var errorsWhileCreatingTheAccount = {};

    // check if the username has already been used
    con.query("SELECT * FROM users WHERE username = ?", [req.body.username] , (err, result) => {
      if(err) throw err;
      if(result.length > 0) {
        errorsWhileCreatingTheAccount.username = "The username has already been used";
      }

      // check if the email has already been used
      con.query("SELECT * FROM users WHERE email = ?", [req.body.email], (err, result) => {
        if(err) throw err;
        if(result.length > 0) {
            errorsWhileCreatingTheAccount.email = "The email has already been used";
        }

        // if there were errors, display them and end the process
        if(Object.keys(errorsWhileCreatingTheAccount).length > 0){
          res.render("signup", {
            SQLErrors: errorsWhileCreatingTheAccount,
            refill: {username: req.body.username, email: req.body.email, gender: req.body.gender, terms: req.body.terms}
          });
          res.end();
        }
        else{
          // make a gender char
          if(req.body.gender == "male") var genderChar = "M";
          if(req.body.gender == "female") var genderChar = "F";
          if(req.body.gender == "other") var genderChar = "O";

          con.query("INSERT INTO users(username, email, password, gender) VALUES(?, ?, ?, ?)", [req.body.username, req.body.email, req.body.password, genderChar], (err, result) => {
            if(err) throw err;
            //log in
            con.query("SELECT ID FROM users WHERE username = ?", [req.body.username], (err, result) => {
              if(err) throw err;
              req.session.userID = result[0].ID;
              req.session.username = req.body.username;
              res.redirect("/account/" + req.body.username);
            })
          })
        }
      })
    })
  }
})

//login
app.all("/users/login", (req, res) => {
  con.query("SELECT * FROM users WHERE username = ? OR email = ?", [req.body.usernameOrEmail, req.body.usernameOrEmail], (err, result) => {
    if(err) throw err;

    //username or email is correct
    if(result.length > 0){

      //password is correct too -> log in
      if(result[0].password == req.body.password){
        req.session.userID = result[0].ID;
        req.session.username = result[0].username;
        res.redirect("/account/" + result[0].username);
      }

      //correct username/email, incorrect password
      else{
        res.render("login", {
          errorPassword: "The password isn't correct",
          refill: {usernameOrEmail: req.body.usernameOrEmail}
        })
      }
    }

    // the email/password isn't correct
    else{
      res.render("login", {
        errorUsernameOrEmail: "The username/email isn't correct",
        refill: {usernameOrEmail: req.body.usernameOrEmail}
      })
    }
  })
})

app.get("/users/logout", (req, res) => {
  req.session.regenerate((err) =>{
    if(err) throw err;
    res.redirect("/")
  })
})

app.post("/users/:username/edit", (req, res) => {

  //check if the username exists in the database
  con.query("SELECT * FROM users WHERE username = ?", [req.params.username], (err, result) =>{
    if(err) throw err;

    //the username exists and it's the user who is currently logged in
    if(result.length == 1 && req.session.username && req.session.username == result[0].username){

      // update the bio
      con.query("UPDATE users SET bio = ? where ID = ?", [req.body.bio, req.session.userID], (err, result) => {
        if (err) throw err
      })

      if(req.body.newProfilePic){
        fs.rename(path.join(__dirname, "public/_data/temp/newProfilePics/" + req.session.username + ".jpg"), path.join(__dirname, "public/_data/users/profilePics/" + req.session.username + ".jpg"), (err) => {
          if (err) throw err;
          con.query("UPDATE users SET hasProfilePic = 1 WHERE ID = ?", [req.session.userID], (err, result) => {
            if(err) throw err;
          })
        });
      }

      res.redirect("/account/" + req.session.username)
    }
  })
})

app.post("/users/:username/edit/profilePic", (req, res) => {

  //check if the username exists in the database
  con.query("SELECT * FROM users WHERE username = ?", [req.params.username], (err, result) =>{
    if(err) throw err;

    //the username exists and it's the user who is currently logged in
    if(result.length == 1 && req.session.username && req.session.username == result[0].username){

      //upload the profile pic
      var form = new formidable.IncomingForm();
      form.keepExtensions = true;
      form.uploadDir = "data/temp"
      form.parse(req, (err, fields, files) => {
        if(err) throw err;
      });
      form.on("file", (field, file) => {

        //save the image
        let imgPath = path.join(__dirname, "public/_data/temp/newProfilePics/" + req.session.username + "." + file.name.split(".")[file.name.split(".").length - 1]);
        console.log("Uploaded an img to " + file.path);
        console.log("Moving the file to " + imgPath);
        fs.rename(file.path, imgPath, (err) => {
          if (err) throw err;
        });

        //convert the image
        jimp.read(imgPath, (err, img) => {
          if(err) throw err;
          img.resize(256, 256)
             .quality(60)
             .write(imgPath.split(".").slice(0, -1).join(".") + ".jpg");
        })
        //if the original extension was different than jpg then delete the original file
        if(file.name.split(".")[file.name.split(".").length - 1] != "jpg"){
          fs.unlink(imgPath, (err) => {
            if (err) throw err;
          })
        }

        req.session.hasUploadedProfilePic = true; // the user has an unsaved profile picture
        res.redirect("/account/" + req.session.username + "/edit?newProfilePic=true") //redirect back with the GET variable
      });
    }
  })
})

io.on("connection", (socket) => {

  // creating an account live feedback
  socket.on("validateTheUsername", (data) => {
    // check if the username has already been used
    con.query("SELECT * FROM users WHERE username = ?", [data.username], (err, result) => {
      if(err) throw err;
      if(result.length > 0) {
        socket.emit("validateTheUsernameErrors", {error: "The username has already been used"});
      }
    })
  })
  socket.on("validateTheEmail", (data) => {
    // check if the username has already been used
    con.query("SELECT * FROM users WHERE email = ?", [data.email], (err, result) => {
      if(err) throw err;
      if(result.length > 0) {
        socket.emit("validateTheEmailErrors", {error: "The email has already been used"});
      }
    })
  })

  // if the user leaves while editing their profile and they have an unsaved profile picture in the temp folder, delete it
  socket.on("leftWhileEditingTheProfile", (data) => {

    // if there is a profile pic in the temp folder, delete it
    let imgPath = path.join(__dirname, "public/_data/temp/newProfilePics/" + req.session.username + ".jpg");
    fs.unlink(imgPath, (err) => {
      if (err) throw err;
    })

  })
})

http.listen(8080, () => {
  console.log("Server started on port 8080...");
})
