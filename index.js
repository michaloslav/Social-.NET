//// CREATE THE SQL TABLES FIRST
//// ADD LIKING AND COMMENTING TO POSTS

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
      jimp = require("jimp"),
      metaphone = require("metaphone"),
      stemmer = require("stemmer"),
      crypto = require("crypto");


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


//update the metaphone in the database
function updateMetaphone(username){
  con.query("SELECT * FROM users WHERE username = ?", [username], (err, result) => {
    if(err){
      console.error(err);
      res.redirect("/error?additionalInfo=" + encodeURI(err));
    }
    var newMetaphone = metaphone(stemmer([result[0].username, result[0].bio].join(" ")));

    // if there are numbers, add them to the metaphone
    if(result[0].username.match(/\d+/g)){
      newMetaphone += result[0].username.match(/\d+/g).join("");
    }
    if(result[0].bio && result[0].bio.match(/\d+/g)){
      newMetaphone += result[0].bio.match(/\d+/g).join("");
    }

    con.query("UPDATE users SET metaphone = ? WHERE ID = ?", [newMetaphone, result[0].ID], (err, result) => {
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }
    })
  })
}

// add a user to the front of the recentlytexted table in the database
function addToRecentlyTexted(userID, otherUser){

  con.query("SELECT usernames FROM recentlytexted WHERE ID = ?", [userID], (err, result) => {

    switch(result.length){

      //if there isn't a row for this user, create one and insert the other user into it
      case 0:
        con.query("INSERT INTO recentlytexted(ID, usernames) VALUES (?, ?)", [userID, JSON.stringify([otherUser])],
        (err, result) =>{
          if(err){
            console.error(err);
            res.redirect("/error?additionalInfo=" + encodeURI(err));
          }
        })

        break;

      // if there is one, everything is fine, get the data and update it
      case 1:
        var usernames = JSON.parse(result[0].usernames);

        // check if the array alread contains the other user
        if(usernames.includes(otherUser)){

          // remove the username we're adding to the beginning
          let index = usernames.indexOf(otherUser)
          if(index > -1){
            usernames.splice(index, 1)
          }
        }

        // add the other user to the beginning of the array
        usernames.unshift(otherUser)


        con.query("UPDATE recentlytexted SET usernames = ? WHERE ID = ?", [JSON.stringify(usernames), userID],
        (err, result) => {
          if(err){
            console.error(err);
            res.redirect("/error?additionalInfo=" + encodeURI(err));
          }
        })

        break;

      // if there is more than one then there's something wrong, throw an error to notify the admin
      default:
        throw "Error adding to the recentlytexted table, there are more than one rows corresponding to the ID";
    }
  })
}


// encrypt the password

function generateRandomString(length){
  // generate random bytes, convert them to hexadecimal and then slice the result so that it is the correct length
  return crypto.randomBytes(Math.ceil(length/2)).toString("hex").slice(0, length);
}

function sha512(text, salt){
  var hash = crypto.createHmac("sha512", salt);
  hash.update(text);
  return hash.digest("hex");
}

function saltHashPassword(password){
  var salt = generateRandomString(16)
  return {
    hash: sha512(password, salt),
    salt: salt
  }
}

// decrypt the password
function checkThePassword(password, hashedPassword, salt){
  return sha512(password, salt) == hashedPassword;
}


// uncomment to update ALL metaphones
/*
con.query("SELECT * FROM users", (err, result) => {
  if(err) throw err;
  for(var i in result){
    updateMetaphone(result[i].username);
  }
})
*/

// init the list of clients
var sockets = {};

// rendering and stuff
app.get("/", (req, res) => {
  if(req.session.username) {

    con.query("SELECT message FROM messages WHERE seen = 0 AND (ID LIKE ? OR ID LIKE ?) AND NOT fromUser = ?",
    [req.session.userID + ":%", "%:" + req.session.userID + ":%", req.session.userID], (err, result) => {
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }

      let messageNotificationCount = result.length;

      con.query("SELECT following FROM following WHERE userID = ?", [req.session.userID], (err, result) => {
        if(err){
          console.error(err);
          res.redirect("/error?additionalInfo=" + encodeURI(err));
        }

        let followedUsers = (result.length != 0 && typeof result[0] !== "undefined") ? JSON.parse(result[0].following) : [];

        // get the posts from the database
        // CHRONOLOGICAL ORDER (NOT MACHINE LEARNING), SHOWS POSTS FROM EVERYONE ON THE WEBSITE
        con.query("SELECT * FROM posts WHERE fromUser IN (?, ?) ORDER BY timestamp DESC", [followedUsers.join(", "), req.session.userID], (err, result) => {
          if(err){
            console.error(err);
            res.redirect("/error?additionalInfo=" + encodeURI(err));
          }

          var postsFromTheDatabase = result;

          // if there are no posts to show the user...
          if(postsFromTheDatabase.length == 0){
            res.render("index", {
              currentUser: req.session.userID,
              messageNotificationCount: messageNotificationCount,
              activePage: "index",
              posts: postsFromTheDatabase
            })
          }

          else{

            // get additional info for each of the posts
            postsFromTheDatabase.forEach((post) => {
              // separate the post and user IDs
              post.userID = post.ID.split(":")[0];
              post.postID = post.ID.split(":")[1];

              // get the username of each of the users
              con.query("SELECT username, hasProfilePic FROM users WHERE ID = ?", [post.userID], (err, result) => {
                if(err){
                  console.error(err);
                  res.redirect("/error?additionalInfo=" + encodeURI(err));
                }

                post.username = result[0].username;
                post.hasProfilePic = result[0].hasProfilePic;

                // if this is the last iteration, continue with the actions
                if(post == postsFromTheDatabase[postsFromTheDatabase.length - 1]){

                  res.render("index", {
                    currentUser: req.session.userID,
                    messageNotificationCount: messageNotificationCount,
                    activePage: "index",
                    posts: postsFromTheDatabase
                  })
                }
              })
            })
          }
        })
      })
    })
  }
  else{
    res.render("index", {
      activePage: "index"
    })
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

    con.query("SELECT message FROM messages WHERE seen = 0 AND (ID LIKE ? OR ID LIKE ?) AND NOT fromUser = ?",
    [req.session.userID + ":%", "%:" + req.session.userID + ":%", req.session.userID], (err, result) => {
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }

      let messageNotificationCount = result.length;

      res.render("terms", {
        currentUser: req.session.userID,
        messageNotificationCount: messageNotificationCount
      })
    })
  }
  else{
    res.render("terms");
  }
})

app.get("/about", (req, res) => {
  if(req.session.username){

    con.query("SELECT message FROM messages WHERE seen = 0 AND (ID LIKE ? OR ID LIKE ?) AND NOT fromUser = ?",
    [req.session.userID + ":%", "%:" + req.session.userID + ":%", req.session.userID], (err, result) => {
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }

      let messageNotificationCount = result.length;

      res.render("about", {
        currentUser: req.session.userID,
        activePage: "about",
        messageNotificationCount: messageNotificationCount
      })
    })
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
  con.query("SELECT * FROM users WHERE username = ?", [req.params.username], (err, result) => {
    if(err){
      console.error(err);
      res.redirect("/error?additionalInfo=" + encodeURI(err));
    }

    //the username exists
    if(result.length == 1){

      // store the info from the database
      let username = result[0].username,
          userID = result[0].ID
          registrationDate = result[0].registrationDate,
          bio = result[0].bio,
          hasProfilePic = result[0].hasProfilePic,
          isCurrentUser = username == req.session.username;

      if(req.session.username){

        con.query("SELECT message FROM messages WHERE seen = 0 AND (ID LIKE ? OR ID LIKE ?) AND NOT fromUser = ?",
        [req.session.userID + ":%", "%:" + req.session.userID + ":%", req.session.userID], (err, result) => {
          if(err){
            console.error(err);
            res.redirect("/error?additionalInfo=" + encodeURI(err));
          }

          let messageNotificationCount = result.length;

          con.query("SELECT following FROM following WHERE userID = ?", [req.session.userID], (err, result) => {
            if(err){
              console.error(err);
              res.redirect("/error?additionalInfo=" + encodeURI(err));
            }

            let isFollowedByCurrentUser = (!isCurrentUser && result.length != 0) ? JSON.parse(result[0].following).includes(userID) : null;

            res.render("account", {
              currentUser: req.session.userID,
              username: username,
              registrationDate: dateFormat(registrationDate, "mmm yyyy"),
              bio: bio,
              isCurrentUser: isCurrentUser,
              hasProfilePic: hasProfilePic == 1,
              userID: userID,
              messageNotificationCount: messageNotificationCount,
              isFollowedByCurrentUser: isFollowedByCurrentUser
            })
          })
        })
      }
      else{
        res.render("account", {
          username: result[0].username,
          registrationDate: dateFormat(result[0].registrationDate, "mmm yyyy"),
          bio: result[0].bio,
          hasProfilePic: result[0].hasProfilePic == 1,
          userID: userID
        })
      }
    }
  })
})

app.get("/account/:username/edit", (req, res) => {

  //check if the username exists in the database
  con.query("SELECT * FROM users WHERE username = ?", [req.params.username], (err, result) =>{
    if(err){
      console.error(err);
      res.redirect("/error?additionalInfo=" + encodeURI(err));
    }

    //the username exists and it's the user who is currently logged in
    if(result.length == 1 && req.session.username && req.session.username == result[0].username){

      // store the user info from the database
      let username = result[0].username,
          registrationDate = result[0].registrationDate,
          bio = result[0].bio;

      con.query("SELECT message FROM messages WHERE seen = 0 AND (ID LIKE ? OR ID LIKE ?) AND NOT fromUser = ?",
      [req.session.userID + ":%", "%:" + req.session.userID + ":%", req.session.userID], (err, result) => {
        if(err){
          console.error(err);
          res.redirect("/error?additionalInfo=" + encodeURI(err));
        }

        let messageNotificationCount = result.length;

        res.render("account", {
          currentUser: req.session.userID,
          username: username,
          registrationDate: dateFormat(registrationDate, "mmm yyyy"),
          bio: bio,
          isCurrentUser: true,
          editing: true,
          newProfilePic: req.query.newProfilePic,
          messageNotificationCount: messageNotificationCount
        })
      })
    }
  })
})

// create an account
app.all("/users/newAccount", [
  // express validator
  check("username")
    .exists().withMessage("The username can't be empty")
    .isLength({ min: 8 }).withMessage("The username must be at least 8 characters long")
    .not().matches(/[^a-zA-Z \d]/).withMessage("The username can only contain letters and numbers"),
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
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }
      if(result.length > 0) {
        errorsWhileCreatingTheAccount.username = "The username has already been used";
      }

      // check if the email has already been used
      con.query("SELECT * FROM users WHERE email = ?", [req.body.email], (err, result) => {
        if(err){
          console.error(err);
          res.redirect("/error?additionalInfo=" + encodeURI(err));
        }
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

          //create the account
          var passwordHashObject = saltHashPassword(req.body.password);
          con.query("INSERT INTO users(username, email, password, salt, gender, metaphone) VALUES(?, ?, ?, ?, ?, ?)",
          [req.body.username, req.body.email, passwordHashObject.hash, passwordHashObject.salt, genderChar, metaphone(stemmer(req.body.username))],
          (err, result) => {
            if(err){
              console.error(err);
              res.redirect("/error?additionalInfo=" + encodeURI(err));
            }

            //log in
            con.query("SELECT ID FROM users WHERE username = ?", [req.body.username], (err, result) => {
              if(err){
                console.error(err);
                res.redirect("/error?additionalInfo=" + encodeURI(err));
              }
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
  con.query("SELECT * FROM users WHERE username = ? OR email = ?", [req.body.usernameOrEmail, req.body.usernameOrEmail],
  (err, result) => {
    if(err){
      console.error(err);
      res.redirect("/error?additionalInfo=" + encodeURI(err));
    }

    //username or email is correct
    if(result.length > 0){

      //password is correct too -> log in
      if(checkThePassword(req.body.password, result[0].password, result[0].salt)){
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
    if(err){
      console.error(err);
      res.redirect("/error?additionalInfo=" + encodeURI(err));
    }
    res.redirect("/")
  })
})

app.post("/users/:username/edit", (req, res) => {

  //check if the username exists in the database
  con.query("SELECT * FROM users WHERE username = ?", [req.params.username], (err, result) =>{
    if(err){
      console.error(err);
      res.redirect("/error?additionalInfo=" + encodeURI(err));
    }

    //the username exists and it's the user who is currently logged in
    if(result.length == 1 && req.session.username && req.session.username == result[0].username){

      // update the bio
      con.query("UPDATE users SET bio = ? where ID = ?", [req.body.bio, req.session.userID], (err, result) => {
        if (err) throw err
        updateMetaphone(req.session.username);
      })

      if(req.body.newProfilePic){
        fs.rename(path.join(__dirname, "public/_data/temp/newProfilePics/" + req.session.username + ".jpg"),
        path.join(__dirname, "public/_data/users/profilePics/" + req.session.username + ".jpg"), (err) => {
          if (err) throw err;
          con.query("UPDATE users SET hasProfilePic = 1 WHERE ID = ?", [req.session.userID], (err, result) => {
            if(err){
              console.error(err);
              res.redirect("/error?additionalInfo=" + encodeURI(err));
            }
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
    if(err){
      console.error(err);
      res.redirect("/error?additionalInfo=" + encodeURI(err));
    }

    //the username exists and it's the user who is currently logged in
    if(result.length == 1 && req.session.username && req.session.username == result[0].username){

      //upload the profile pic
      var form = new formidable.IncomingForm();
      form.keepExtensions = true;
      form.uploadDir = "data/temp"
      form.parse(req, (err, fields, files) => {
        if(err){
          console.error(err);
          res.redirect("/error?additionalInfo=" + encodeURI(err));
        }
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
          if(err){
            console.error(err);
            res.redirect("/error?additionalInfo=" + encodeURI(err));
          }
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

app.get("/search", (req, res) => {
  var searchQuery = metaphone(stemmer(req.query.search));

  // if there are numbers, add them to the query
  if(req.query.search.match(/\d+/g)){
    searchQuery += req.query.search.match(/\d+/g).join("");
  }

  con.query("SELECT * FROM users WHERE metaphone LIKE ?", ["%" + searchQuery + "%"], (err, result) => {
    if(err){
      console.error(err);
      res.redirect("/error?additionalInfo=" + encodeURI(err));
    }
    var searchResults = [];
    if(result.length > 0){
      for(var i in result){
        searchResults.push({userID: result[i].ID, username: result[i].username, bio: result[i].bio, hasProfilePic: result[i].hasProfilePic});
      }
    }
    if(req.session.username){

      con.query("SELECT message FROM messages WHERE seen = 0 AND (ID LIKE ? OR ID LIKE ?) AND NOT fromUser = ?",
      [req.session.userID + ":%", "%:" + req.session.userID + ":%", req.session.userID], (err, result) => {
        let messageNotificationCount = result.length;

        // check if the current user follows the users in searchResults
        searchResults.forEach((searchResult) => {
          con.query("SELECT following FROM following WHERE userID = ?", [req.session.userID], (err, result) => {
            if(err){
              console.error(err);
              res.redirect("/error?additionalInfo=" + encodeURI(err));
            }

            // if the current user follows anyone...
            if(result.length != 0){
              // if the array of the users the currentUser follows includes the user in the current searchResult...
              if(JSON.parse(result[0].following).includes(Number(searchResult.userID))) searchResult.followedByCurrentUser = true;
            }

            // check if the user from the searchResut follows the currentUser
            con.query("SELECT following FROM following WHERE userID = ?", [searchResult.userID], (err, result) => {
              if(err){
                console.error(err);
                res.redirect("/error?additionalInfo=" + encodeURI(err));
              }

              // if the user follows anyone...
              if(result.length != 0){
                // if the array of users the searchResult user follows includes the currentUser...
                if(JSON.parse(result[0].following).includes(Number(req.session.userID))) searchResult.followsCurrentUser = true;
              }

              // if this is the last iteration, continue
              if(searchResult == searchResults[searchResults.length - 1]){
                res.render("search", {
                  currentUser: req.session.userID,
                  searchQuery: req.query.search,
                  searchResults: searchResults,
                  messageNotificationCount: messageNotificationCount
                })
              }
            })
          })
        })
      })
    }
    else{
      res.render("search", {
        searchQuery: req.query.search,
        searchResults: searchResults
      })
    }
  })
})

// redirect to the last texted user
app.get("/messages", (req, res) => {

  // get the ID of the person that the user last texted/was texted from
  con.query("SELECT usernames FROM recentlytexted WHERE ID = ?", [req.session.userID], (err, result) => {
    if(err){
      console.error(err);
      res.redirect("/error?additionalInfo=" + encodeURI(err));
    }

    // if there isn't a recentlytexted field for the currentUser...
    if(result.length == 0){
      res.render("noMessagesYet", {
        currentUser: req.session.userID,
        messageNotificationCount: 0
      })
    }

    else{
      // get the username of the first person in the array
      con.query("SELECT username FROM users WHERE ID = ?", [JSON.parse(result[0].usernames)[0]], (err, result) => {
        if(err){
          console.error(err);
          res.redirect("/error?additionalInfo=" + encodeURI(err));
        }

        // redirect
        res.redirect("/messages/" + result[0].username);
      })
    }
  })
})

app.get("/messages/:username", (req, res) => {

  // check if the user is logged in
  if(!req.session.username) {
    res.redirect("/");
    res.end();
  }

  else{

    // check if the username in the URL is real
    con.query("SELECT * FROM users WHERE username = ?", [req.params.username], (err, result) =>{
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }

      if(result.length == 0) {
        res.redirect("/");
        res.end();
      }
      else{

        var toUser = result[0].ID;
        var toUserUsername = result[0].username;
        var messageLikeStatement = (req.session.userID > toUser ? toUser + ":" + req.session.userID : req.session.userID + ":" + toUser ) + ":%";

        // get the recentlytexted
        con.query("SELECT usernames FROM recentlytexted WHERE ID = ?", [req.session.userID], (err, result) => {
          if(err){
            console.error(err);
            res.redirect("/error?additionalInfo=" + encodeURI(err));
          }

          var recentlyTextedIDs = result.length == 1 ? JSON.parse(result[0].usernames) : [toUser];

          // get the actual usernames from the IDs (the recentlytexted table only contains ID numbers)
          con.query("SELECT ID, username FROM users WHERE ID IN(" + recentlyTextedIDs.join(",") + ") ORDER BY FIELD(ID, " + recentlyTextedIDs.join(",") + ")", (err, result) => {
            if(err){
              console.error(err);
              res.redirect("/error?additionalInfo=" + encodeURI(err));
            }

            var recentlyTexted = [];
            result.forEach((row) => {
              recentlyTexted.push({userID: row.ID,
                username: row.username
              })
            })

            // get the messages
            con.query("SELECT * FROM messages WHERE ID LIKE ? ORDER BY `messages`.`sentTime` ASC",
            [messageLikeStatement], (err, result) => {
              if(err){
                console.error(err);
                res.redirect("/error?additionalInfo=" + encodeURI(err));
              }
              var messages = [];
              result.forEach((row) => {
                messages.push({fromOrTo: (row.fromUser == req.session.userID ? "From" : "To"),
                  message: row.message
                })
              })

              // get the unseen messages for each of the users
              con.query("SELECT message, fromUser FROM messages WHERE seen = 0 AND (ID LIKE ? OR ID LIKE ?) AND NOT fromUser = ?",
              [req.session.userID + ":%", "%:" + req.session.userID + ":%", req.session.userID], (err, result) => {
                if(err){
                  console.error(err);
                  res.redirect("/error?additionalInfo=" + encodeURI(err));
                }
                let messageNotificationCount = result.length;

                // unseen messages for each user separately
                var unseenMessageCounterForEachUser = {};
                result.forEach((row) => {
                  // if the fromUser of the row is already in the array, increment the
                  if(typeof unseenMessageCounterForEachUser[row.fromUser] != "undefined") unseenMessageCounterForEachUser[row.fromUser]++;

                  // if the fromUser isn't in the array, put him there and set the value to one
                  else unseenMessageCounterForEachUser[row.fromUser] = 1;
                })

                res.render("messages", {
                  currentUser: req.session.userID,
                  toUser: toUser,
                  toUserUsername: toUserUsername,
                  recentlyTexted: recentlyTexted,
                  messages: messages,
                  messageNotificationCount: messageNotificationCount,
                  unseenMessageCounterForEachUser: unseenMessageCounterForEachUser
                })
              })
            })
          })
        })

        // update the seen parameter
        con.query("UPDATE messages SET seen = 1 WHERE fromUser = ? AND ID LIKE ? AND seen = 0",
        [toUser, messageLikeStatement], (err, result) => {
          if(err){
            console.error(err);
            res.redirect("/error?additionalInfo=" + encodeURI(err));
          }
        })
      }
    })
  }
})

app.get("/newPost", (req, res) => {
  if(req.session.username){

    con.query("SELECT message FROM messages WHERE seen = 0 AND (ID LIKE ? OR ID LIKE ?) AND NOT fromUser = ?",
    [req.session.userID + ":%", "%:" + req.session.userID + ":%", req.session.userID], (err, result) => {
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }

      let messageNotificationCount = result.length;

      res.render("newPost", {
        currentUser: req.session.userID,
        messageNotificationCount: messageNotificationCount
      })
    })
  }
  else{
    res.redirect("/");
  }
})

app.post("/post/newPost", (req, res) => {

  // get the post counter
  con.query("SELECT counter FROM postcounter WHERE ID = ?", [req.session.userID], (err, result) => {
    if(err){
      console.error(err);
      res.redirect("/error?additionalInfo=" + encodeURI(err));
    }

    // if the counter doesn't exit, create it
    if(result.length == 0){
      var postID = req.session.userID + ":1"
      con.query("INSERT INTO postcounter(ID, counter) VALUES (?, 1)", [req.session.userID], (err, result) => {
        if(err){
          console.error(err);
          res.redirect("/error?additionalInfo=" + encodeURI(err));
        }
      })
    }

    // if the counter exists, augment its value
    else{
      var postID = req.session.userID + ":" + (Number(result[0].counter) + 1);
      con.query("UPDATE postcounter SET counter = counter + 1 WHERE ID = ?", [req.session.userID], (err, result) => {
        if(err){
          console.error(err);
          res.redirect("/error?additionalInfo=" + encodeURI(err));
        }
      })
    }

    // store the post itself
    con.query("INSERT INTO posts(ID, text, fromUser) VALUES (?, ?, ?)", [postID, req.body.postText, req.session.userID], (err, result) => {
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }
    })

    res.redirect("/");
  })
})

app.get("/post", (req, res) => {

  // if the get parameters aren't set correctly, redirect
  if(typeof req.query.user == "undefined" || typeof req.query.postid == "undefined") res.redirect("/")

  else{
    con.query("SELECT * FROM posts WHERE ID = ?", [req.query.user + ":" + req.query.postid], (err, result) => {
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }

      // if the post doesn't exit, redirect
      if(result.length == 0) res.redirect("/")
      else{
        // store the post
        var postFromTheDatabase = result[0];

        // get the separate IDs
        postFromTheDatabase.userID = req.query.user;
        postFromTheDatabase.postID = req.query.postid;

        // get the poster's username
        con.query("SELECT username, hasProfilePic FROM users WHERE ID = ?", [req.query.user], (err, result) => {
          if(err){
            console.error(err);
            res.redirect("/error?additionalInfo=" + encodeURI(err));
          }

          postFromTheDatabase.username = result[0].username;
          postFromTheDatabase.hasProfilePic = result[0].hasProfilePic;

          // display the post
          if(req.session.username){

            con.query("SELECT message FROM messages WHERE seen = 0 AND (ID LIKE ? OR ID LIKE ?) AND NOT fromUser = ?",
            [req.session.userID + ":%", "%:" + req.session.userID + ":%", req.session.userID], (err, result) => {
              if(err){
                console.error(err);
                res.redirect("/error?additionalInfo=" + encodeURI(err));
              }

              let messageNotificationCount = result.length;

              res.render("post", {
                currentUser: req.session.userID,
                messageNotificationCount: messageNotificationCount,
                post: postFromTheDatabase
              })
            })
          }

          else{
            res.render("post", {
              post: postFromTheDatabase
            })
          }
        })
      }
    })
  }
})

app.get("/users/follow", (req, res) => {
  // check if the currentUser from the URL is really the current user
  if(req.session.userID != req.query.currentUser) res.end();
  else{
    con.query("SELECT following FROM following WHERE userID = ?", [req.session.userID], (err, result) => {
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }

      // if the currentUser isn't in the following table yet, create a field for them
      if(result.length == 0){
        con.query("INSERT INTO following(userID, following) VALUES(?, ?)",
        [req.session.userID, JSON.stringify([Number(req.query.userID)])], (err, result) => {
          if(err){
            console.error(err);
            res.redirect("/error?additionalInfo=" + encodeURI(err));
          }

          res.redirect("/account/" + req.query.userUsername);
        })
      }

      // if the currentUser is already in the table, add the userID to the array
      else{
        var following = JSON.parse(result[0].following);
        following.push(Number(req.query.userID));
        con.query("UPDATE following SET following = ? WHERE userID = ?", [JSON.stringify(following), req.session.userID],
        (err, result) => {
          if(err){
            console.error(err);
            res.redirect("/error?additionalInfo=" + encodeURI(err));
          }

          res.redirect("/account/" + req.query.userUsername);
        })
      }
    })
  }
})

app.get("/users/unfollow", (req, res) => {
  // check if the currentUser from the URL is really the current user
  if(req.session.userID != req.query.currentUser) res.redirect("/error?message=CannotUnfollow");
  else{
    con.query("SELECT following FROM following WHERE userID = ?", [req.session.userID], (err, result) => {
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }

      // if the currentUser isn't in the following that means they don't follow anyone -> they can't unfollow -> redirect
      if(result.length == 0) res.redirect("/error?message=CannotUnfollow");

      // if the currentUser is in the table, check if the user ID is in the array
      else{
        var following = JSON.parse(result[0].following);
        if(!following.includes(Number(req.query.userID))) res.redirect("/error?message=CannotUnfollow");
        else{
          var index = following.indexOf(Number(req.query.userID));
          if(index > -1){
            following.splice(index, 1);
          }
          con.query("UPDATE following SET following = ? WHERE userID = ?", [JSON.stringify(following), req.session.userID],
          (err, result) => {
            if(err){
              console.error(err);
              res.redirect("/error?additionalInfo=" + encodeURI(err));
            }

            res.redirect("/account/" + req.query.userUsername);
          })
        }
      }
    })
  }
})

app.get("/error", (req, res) => {
  var errorInfo = {};
  errorInfo.message = req.query.message ? req.query.message : null,
  errorInfo.additionalInfo = req.query.additionalInfo ? req.query.additionalInfo : null,
  errorInfo.status = req.query.status ? req.query.status : null;

  if(req.session.username){

    con.query("SELECT message FROM messages WHERE seen = 0 AND (ID LIKE ? OR ID LIKE ?) AND NOT fromUser = ?",
    [req.session.userID + ":%", "%:" + req.session.userID + ":%", req.session.userID], (err, result) => {
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }

      let messageNotificationCount = result.length;

      res.render("error", {
        currentUser: req.session.userID,
        messageNotificationCount: messageNotificationCount,
        errorInfo: errorInfo
      })
    })
  }

  else{
    res.render("error", {
      errorInfo: errorInfo
    })
  }
})





// handle 404
app.use((req, res) => {
  res.status(404);
  res.render("error", {
    dontLoadNavbar: true,
    errorInfo: {
      message: "Page not found",
      status: 404,
      additionalInfo: null
    }
  })
})

// handle 500
app.use((error, req, res, next) => {
  res.status(500);
  res.render("error", {
    dontLoadNavbar: true,
    errorInfo: {
      message: "Sorry, something went wrong on our server",
      status: 500,
      additionalInfo: null
    }
  })
})

io.on("connection", (socket) => {

  // creating an account live feedback
  socket.on("validateTheUsername", (data) => {
    // check if the username has already been used
    con.query("SELECT * FROM users WHERE username = ?", [data.username], (err, result) => {
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }
      if(result.length > 0) {
        socket.emit("validateTheUsernameErrors", {error: "The username has already been used"});
      }
    })
  })
  socket.on("validateTheEmail", (data) => {
    // check if the username has already been used
    con.query("SELECT * FROM users WHERE email = ?", [data.email], (err, result) => {
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }
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

  // store the username and the user into the sockets variable
  socket.on("rememberTheSocket", (data) => {
    if(!sockets[data.user]) sockets[data.user] = [socket.id]
    else{
      if(!sockets[data.user].includes(socket.id)) sockets[data.user].push(socket.id);
    }
  })

  // forget the socket when the user leaves the page
  socket.on("forgetTheSocket", (data) => {
    if(typeof sockets[data.user] !== "undefined" && sockets[data.user].includes(socket.id)){
      let index = sockets[data.user].indexOf(socket.id);
      if(index !== -1) sockets[data.user].splice(index, 1);
    }
  })


  // a message was sent
  socket.on("messageSent", (data) => {

    // get the user inputs
    var fromUser = data.fromUser;
    var toUser = data.toUser;

    //check if the fromUser is correct
    if(typeof sockets[fromUser] !== "undefined" && sockets[fromUser].includes(socket.id)){
      // get the usersID
      var usersID = (toUser > fromUser ? fromUser + ":" + toUser : toUser + ":" + fromUser);

      con.query("SELECT counter FROM messagecounter WHERE ID = ?", [usersID], (err, result) => {
        if(err){
          console.error(err);
          res.redirect("/error?additionalInfo=" + encodeURI(err));
        }

        // if there isn't a message counter yet, create one
        if(result.length == 0){

          var messageID = usersID + ":1";
          con.query("INSERT INTO messagecounter(ID, counter) VALUES (?, ?)", [usersID, 1], (err, result) => {
            if(err){
              console.error(err);
              res.redirect("/error?additionalInfo=" + encodeURI(err));
            }
          })
        }

        // if it already exists, augment it
        else{

          var messageID = usersID + ":" + result[0].counter;

          con.query("UPDATE messagecounter SET counter = counter + 1 WHERE ID = ?", [usersID], (err, result) => {
            if(err){
              console.error(err);
              res.redirect("/error?additionalInfo=" + encodeURI(err));
            }
          })
        }

        // save the actual message
        con.query("INSERT INTO messages(ID, message, fromUser) VALUES(?, ?, ?)",
        [messageID, data.message, data.fromUser], (err, result) =>{
          if(err){
            console.error(err);
            res.redirect("/error?additionalInfo=" + encodeURI(err));
          }

          // if the other user is online, emit the message to them
          io.to(sockets[toUser]).emit("messageReceived", {
            message: data.message,
            fromUser: data.fromUser,
            messageID: messageID
          })

          // also emit a messageNotification to update the navbar
          io.to(sockets[toUser]).emit("messageNotification")
        })

        // call the function to update the recentlytexted table in the database for both users
        addToRecentlyTexted(fromUser, toUser);
        addToRecentlyTexted(toUser, fromUser);
      })
    }
  })

  socket.on("messageSeen", (data) => {
    con.query("UPDATE messages SET seen = 1 WHERE ID = ?", [data.messageID], (err, result) => {
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }
    })
  })

  // MESSAGE RECEIVED ->  MESSAGE RECEIVED NOT IN THE RECENTLY TEXTED LIST -> MESSAGE RECEIVED NOT IN THE RECENTLY TEXTED LIST RESPONSE
  socket.on("messageReceivedNotInTheRecentlyTextedList", (data) => {
    // get the username of the fromUser
    con.query("SELECT username FROM users WHERE ID = ?", [data.fromUser], (err, result) => {
      if(err){
        console.error(err);
        res.redirect("/error?additionalInfo=" + encodeURI(err));
      }

      socket.emit("messageReceivedNotInTheRecentlyTextedListResponse", {
        fromUser: data.fromUser,
        fromUserUsername: result[0].username
      })
    })
  })

  // like a post
  socket.on("like", (data) => {

  })

  //dislike a post
  socket.on("dislike", (data) => {

  })
})

http.listen(8080, () => {
  console.log("Server started on port 8080...");
})
