$(() => {

  // change the profile pic form
  $("#changeTheProfilePicDiv").click(() => {
    $("#changeTheProfilePicInput").trigger("click");
  });
  $("#changeTheProfilePicInput").change(function(){
  	$("#changeTheProfilePicForm").submit();
  });

  // connect to Socket.IO
  const socket = io.connect("http://127.0.0.1:8080");
  if(socket != undefined){
    console.log("Connected to Socket.IO");
  }
  else {
    console.log("Error connecting to Socket.IO");
  }

  //if there are unsaved changes and the user wants to leave, show a warning
  var formHasChanged = newProfilePic ? "true" : "false";
  var submitted = false;

  $(document).on('change', 'bioInput', (e) => {
    formHasChanged = true;
  });

  $(document).ready(() => {
    window.onbeforeunload = (e) => {
      if(formHasChanged && !submitted){
        var confirmLeaving = confirm("If you leave the page now, the changes will NOT be saved.");
        if(confirmLeaving){
          return true;
          socket.emit("leftWhileEditingTheProfile");
        }
        else return false;
      }
    }

    $("form").submit(function() {
      submitted = true;
    });
  });

});
