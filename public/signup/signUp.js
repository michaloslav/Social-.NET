$(() => {
  // connect to Socket.IO
  const socket = io.connect("http://127.0.0.1:8080");
  if(socket != undefined){
    console.log("Connected to Socket.IO");
  }
  else {
    console.log("Error connecting to Socket.IO");
  }

  function eraseErrors(field){
    $("#" + field + "InputGroup .registrationError").remove();
  }

  function showError(field, error){
    var errorID = "error" + error.replace(/["'\s]/g, "");
    $("#" + errorID).remove();
    $("#" + field + "InputGroup").append('<p class="text-danger registrationError" id="' + errorID + '">' + error + '</p>');
    let deleteTheError = setTimeout(() => {
      console.log("Removing " + "#" + errorID);
      $("#" + errorID).remove();
    }, 4000)
  }

  $("#usernameInput").blur(() => {
    eraseErrors("username");
    if($("#usernameInput").val().length < 8) {
      showError("username", "The username must be at least 8 characters long");
    }
    socket.emit("validateTheUsername", {
      username: $("#usernameInput").val()
    })
    socket.on("validateTheUsernameErrors", (data) => {
      showError("username", data.error);
    })
  })

  $("#emailInput").blur(() => {
    eraseErrors("email");
    if($("#emailInput").val().length < 1) {
      showError("email", "The email can't be empty");
    }
    socket.emit("validateTheEmail", {
      email: $("#emailInput").val()
    })
    socket.on("validateTheEmailErrors", (data) => {
      showError("email", data.error);
    })
  })
  $("#passwordInput").blur(() => {
    eraseErrors("password");
    if($("#passwordInput").val().length < 8) {
      showError("password", "The password must be at least 8 characters long");
    }
      if(!/[0-9]/g.test($("#passwordInput").val())) {
        showError("password", "The password must contain at least one number");
      }
  })
})
