$(() => {

  // define the chucksum function
  function getChecksum(a, b){
    return a + b;
  }

  // create a checksum of the to and from user
  const usersChecksum = getChecksum(toUser, fromUser);

  // scroll to the bottom
  $("#messagesDiv").animate({ scrollTop: ($("#messagesDiv").prop("scrollHeight"))}, 500);

  // send the message
  $("#messageSend").click(() => {

    var message = $("#messageInput").val();

    // if the message isn't empty and the checksum works...
    if(message !== "" && usersChecksum == getChecksum(toUser, fromUser)){

      // send the message through Socket.IO
      socket.emit("messageSent", {
        fromUser: fromUser,
        toUser: toUser,
        message: message
      })

      // append the sent message to the div
      $("#messagesDiv").append('<div class="list-group-item borderless messageContainer"><div class="message messageFrom">' + message + '</div></div>');

      // erase the input field
      $("#messageInput").val("");

      // scroll to the bottom
      $("#messagesDiv").animate({ scrollTop: ($("#messagesDiv").prop("scrollHeight"))}, 200);
    }
  })

  //send the message if the user hits enter
  $("#messageInput").on("keydown", (e) => {
    if(e.which == 13 && e.shiftKey == false){
      $("#messageSend").trigger("click");
    }
  })

  socket.on("messageReceived", (data) => {

    // append the received message to the div
    $("#messagesDiv").append('<div class="list-group-item borderless messageContainer"><div class="message messageTo">' + data.message + '</div></div>');

    // scroll to the bottom
    $("#messagesDiv").animate({ scrollTop: ($("#messagesDiv").prop("scrollHeight"))}, 200);
  })

})
