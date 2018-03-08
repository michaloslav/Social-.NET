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

      // if the user we just texted isn't in the recently texted list, prepend them there
      if($("#recentlyTextedLinkUser" + toUser).length == 0){
        $("#recentlyTextedList").prepend('<a ' +
        'class="list-group-item border px-0 px-sm-2 py-sm-3 pb-2 d-inline-block text-truncate btn btn-light"' +
          'href="/messages/' + toUserUsername + '" id="recentlyTextedLinkUser' + toUser + '">' +
          toUserUsername +
          '<span class="badge badge-pill badge-info" id="messageNotificationFromUser' + toUser + '">1</span>' +
          '</a>');        
      }
    }
  })

  //send the message if the user hits enter
  $("#messageInput").on("keydown", (e) => {
    if(e.which == 13 && e.shiftKey == false){
      $("#messageSend").trigger("click");
    }
  })

  socket.on("messageReceived", (data) => {

    // if the message was sent from the user we're currently texting, display it
    if(data.fromUser == toUser){
      // append the received message to the div
      $("#messagesDiv").append('<div class="list-group-item borderless messageContainer"><div class="message messageTo">' + data.message + '</div></div>');

      // scroll to the bottom
      $("#messagesDiv").animate({ scrollTop: ($("#messagesDiv").prop("scrollHeight"))}, 200);

      // send the seen signal
      socket.emit("messageSeen", {
        messageID: data.messageID
      })
    }

    // if it was sent by someone else, show a notification in the recently texted section
    else{
      // if the recently texted link doesn't yet exist for this user, create it (we need their username first)
      if($("#recentlyTextedLinkUser" + data.fromUser).length == 0) socket.emit("messageReceivedNotInTheRecentlyTextedList", {fromUser: data.fromUser})

      // if there already is a recently texted link for this user, update or create the notificaion badge
      else{
        // if the notification badge from the user who sent the message already exists, increment it's value
        if($("#messageNotificationFromUser" + data.fromUser).length == 1) $("#messageNotificationFromUser" + data.fromUser).text(Number($("#messageNotificationFromUser" + data.fromUser).text()) + 1)

        // if it doesn't yet exit, create it
        else $("#recentlyTextedLinkUser" + data.fromUser).append('<span class="badge badge-pill badge-info" id="messageNotificationFromUser' + data.fromUser + '">1</span>')
      }
    }
  })

  // this singal is received after a receiving a message from a user who isn't in the recently texted list (we need their username to create their item in the list)
  // MESSAGE RECEIVED ->  MESSAGE RECEIVED NOT IN THE RECENTLY TEXTED LIST -> MESSAGE RECEIVED NOT IN THE RECENTLY TEXTED LIST RESPONSE
  socket.on("messageReceivedNotInTheRecentlyTextedListResponse", (data) => {
    $("#recentlyTextedList").prepend('<a ' +
    'class="list-group-item border px-0 px-sm-2 py-sm-3 pb-2 d-inline-block text-truncate btn btn-light"' +
      'href="/messages/' + data.fromUserUsername + '" id="recentlyTextedLinkUser' + data.fromUser + '">' +
      data.fromUserUsername +
      '<span class="badge badge-pill badge-info" id="messageNotificationFromUser' + data.fromUser + '">1</span>' +
      '</a>')
  })
})
