//
// Makes an AJAX request to a local server function w/ optional arguments
//
// functionName: the name of the server's AJAX function to call
// opt_argv: an Array of arguments for the AJAX function
//
function Request(function_name, opt_argv) {

  if (!opt_argv)
    opt_argv = new Array();
 
  // Find if the last arg is a callback function; save it
  var callback = null;
  var len = opt_argv.length;
  if (len > 0 && typeof opt_argv[len-1] == 'function') {
    callback = opt_argv[len-1];
    opt_argv.length--;
  }
  var async = (callback != null);

  var call_array = new Array(function_name);
  for (var i = 0; i < opt_argv.length; i++) {
     call_array.push(opt_argv[i]);
  }
  
  var post_body = Object.toJSON(call_array);

  new Ajax.Request('/rpc', {
     async: async,
     method: 'post',
     //parameters: call_hash,
     postBody: post_body,
     onCreate: function() {call_counter++;},
     onSuccess: function(transport) {
        callback(transport.responseText.evalJSON(true));
     },
     onComplete: function() {call_counter--;update_working();}
   });

}

// Adds a stub function that will pass the arguments to the AJAX call 
function InstallFunction(obj, functionName) {
  obj[functionName] = function() { Request(functionName, arguments); }
}


// Server object that will contain the callable methods
var server = {};

// Insert 'Friends' as the name of a callable method
InstallFunction(server, 'TwitterFriends');
InstallFunction(server, 'FFSubscriptions');
//InstallFunction(server, 'FFSearch');
InstallFunction(server, 'FFProfile');
InstallFunction(server, 'TwitterUser');
InstallFunction(server, 'FFSubscribe');
InstallFunction(server, 'TwitterFollow');
InstallFunction(server, 'InviteToFF');


var friends = [];
var ffs = [];
var twitter_friend_retry_counter = 0;
var call_counter = 0;
var working_div_is_relevant = false;

var digg_url = 'http://digg.com/software/Twitter_to_FriendFeed';

function init() {
  var objURL = new Object();

  window.location.search.replace(
    new RegExp( "([^?=&]+)(=([^&]*))?", "g" ),
      function( $0, $1, $2, $3 ){
        objURL[ $1 ] = $3;
      }
  );

  if (objURL['tuser']) { $('t_user').writeAttribute('value', objURL['tuser']); }
  if (objURL['tpass']) { $('t_pass').writeAttribute('value', objURL['tpass']); }
  if (objURL['ffuser']) { $('ff_user').writeAttribute('value', objURL['ffuser']); }
  if (objURL['ffkey']) { $('ff_remotekey').writeAttribute('value', objURL['ffkey']); }
  
}

Event.observe(window, 'load', init);


function error_check(response) {
  if (response[0] == "error") {
    alert(response[1]);
    return true;
  }
  return false;
}

function update_working() {  
  if (working_div_is_relevant) {
    $('working').update('Working...'+call_counter);
    if (call_counter == 0) { 
       create_invitations();
       $('working').toggle(); 
       $('sub_form').toggle(); 
       working_div_is_relevant = false;
       $('bookmark').writeAttribute('href', '/?tuser='+$F('t_user')+'&tpass='+$F('t_pass')+'&ffuser='+$F('ff_user')+'&ffkey='+$F('ff_remotekey'));
    }
  }
}

// Client functions that results from user actions (button clicks)

function getTwitterFriends() {
  server.TwitterFriends($('t_user').value, $('t_pass').value, $('t_page').value, onTwitterFriendsSuccess);
}

function getFFSubs() {
  server.FFSubscriptions($('ff_user').value, $('ff_remotekey').value, onFFSubsSuccess);
}

function FFSubscribe(nickname, verified) {
  if (verified || confirm("Are you sure?")) {
     server.FFSubscribe($('ff_user').value, $('ff_remotekey').value, nickname, onFFSubscribeSuccess);
  }   
}

function TwitterFollow(user) {
  server.TwitterFollow($('t_user').value, $('t_pass').value, user, onTwitterFollowSuccess);
}
   
function inviteToFF(user) {
  message = 'Come join me (http://friendfeed.com/#{ff}) on FriendFeed!'.interpolate({ff: $('ff_user').value});
  if (confirm('Confirm DM (a public @reply will be sent if the DM fails): "'+message+'"')) {
     server.InviteToFF($('t_user').value, $('t_pass').value, user, message, onInviteToFFSuccess);
  }
}
   
// Call back functions

function onTwitterFriendsSuccess(response) {
  //if (error_check(response)) { return; }
  if (response[0] == "error") { 
     if (response[1] == 'Unknown Error') {
        // GAWD, the GAE can be such a bitch about urlfetch calls (re-try)
        twitter_friend_retry_counter++;
        if (twitter_friend_retry_counter < 5) {
           getTwitterFriends();
        }
        else {
           alert("Error: Twitter API returned too many errors. Please try again later");
        }
     }
     else {
        error_check(response);
     }
  }
  else {
    $('twitter_search').disable();
    page = response[0]
    for (var x = 1; x < response.length; ++x) {
       // only add rows for Twitter friends who are not already in the table
       if (friends.indexOf(response[x][0]) == -1) {
         $('twit_table').insert('<tr id="row_#{username}"><td id="friend_#{username}"><img border="0" src="#{url}" height="25" width="25"/> <a href="http://twitter.com/#{username}">#{name}<a/></td><td id="ff_#{username}">&nbsp;</td><td id="verified_#{username}">&nbsp;</td><td id="sub_#{username}">&nbsp;</td></tr>'.interpolate(
           {username: response[x][0], name: response[x][1], url: response[x][2]} ));
         friends.push(response[x][0]);
       }
    }
    // currently the maximum number of results from Twitter = 100 (+ page number variable)
    //if (response.length == 101) {
    //   $('t_page').writeAttribute('value', ++page);
    //   getTwitterFriends();
    //}
    //else { 
      $('t_header').update("Twitter ("+friends.length+" friends)");
      $('ff_form').show();
      $('output').show();
    //}
  }
}

function onFFSubsSuccess(response) {
  if (error_check(response)) { return; }
  
  // fill-in information for FF users whose nicknames matched their Twitter id's
  $('get_subscriptions').disable();
  for (var x = 0; x < response.length; ++x) {
     ffs.push(response[x][0]);
     if (friends.indexOf(response[x][0]) != -1) {
       $('ff_'+response[x][0]).update("<img border=\"0\" src=\"http://friendfeed.com/" + response[x][0] +"/picture?size=small\" height=\"25\" width=\"25\"/> <a href=\"http://friendfeed.com/" + response[x][0] +"\">" + response[x][1] + "</a>");
       $('sub_'+response[x][0]).update( 
          "<input id=\"subscribe_" + response[x][0] + "\" type=\"button\" value=\"subscribed\" disabled=\"true\"/>");
     }
  }
  
  // I'm giving up on this for now.  It just fails too much on the server-side (DeadlineExceededError)
  // server.FFSearch($('ff_user').value, $('ff_remotekey').value, twitter_unmatched, 'no_override', onFFSearchSuccess); 

  working_div_is_relevant = true;

  
  // Perform a look-up on all un-matched Twitter friends
  for (var x = 0; x < friends.length; ++x) {
     if (ffs.indexOf(friends[x]) == -1) {
       server.FFProfile($('ff_user').value, $('ff_remotekey').value, friends[x], 'no-override', onFFProfileSuccess);
     }
  }      

  // Perform a look-up on all un-matched FF subscriptions
  for (var x = 0; x < ffs.length; ++x) {
     if (friends.indexOf(ffs[x]) == -1) {
       server.FFProfile($('ff_user').value, $('ff_remotekey').value, ffs[x], 'override', onFFProfileSuccess);
     }
  }
     
  $('ff_header').update("FriendFeed ("+ffs.length+" subscriptions)");
}


function onFFProfileSuccess(response) {
  if (response[0] == "error") { 
    // couldn't find the user, no worries
  }
  else {
    if (friends.indexOf(response[0]) != -1) {
      $('ff_'+response[0]).update("<img src=\"http://friendfeed.com/" + response[1] +"/picture?size=small\" height=\"25\" width=\"25\"/> <a href=\"http://friendfeed.com/" + response[1] +"\">" + response[2] + "</a>");
      if (ffs.indexOf(response[1]) != -1) {
        $('row_'+response[0]).removeClassName('newfriend');
        $('ff_'+response[0]).removeClassName('newfriend');
        $('verified_'+response[0]).update('&nbsp;');
        $('sub_'+response[0]).update('<input id="subscribe_#{twitter}" type="button" value="subscribed" disabled="true"/>'.interpolate({twitter: response[0]}));          
      }
      else {
        if (!$('subscribe_'+response[0])) {
           $('row_'+response[0]).addClassName('newfriend');
           $('verified_'+response[0]).update('<img src="/static/' + (response[3] ? 'check.png' : 'x.gif') + '" title="connection between accounts '+(response[3] ? '' : 'not')+' verified"/>');
           $('ff_'+response[0]).addClassName('newfriend');
           $('sub_'+response[0]).update(
             "<input id=\"subscribe_" + response[1] + "\" type=\"button\" value=\"subscribe\" onclick=\"FFSubscribe('" + response[1] + "'," + response[3] + ")\"/>");               
        }
      }
    }
    else {
      if (response[0] != '') {
        $('twit_table').insert('<tr id="row_#{twitter}" class="newfriend"><td id="friend_#{twitter}" class="newfriend"><img border="0" src="http://static.twitter.com/images/default_profile_normal.png" height="25" width="25"/> <a href="http://twitter.com/#{twitter}">#{twitter}<a/></td><td id="ff_#{ff_user}"><img src="http://friendfeed.com/#{ff_user}/picture?size=small" height="25" width="25"/> <a href="http://friendfeed.com/#{ff_user}">#{name}</a></td><td id="verified_#{username}"><img src="/static/check.png" title="connection between accounts verified"/></td><td><input id="follow_#{twitter}" type="button" value="follow" onclick="TwitterFollow(\'#{twitter}\')"/></td></tr>'.interpolate(
           {ff_user: response[1], name: response[2], twitter: response[0]} ));
        server.TwitterUser($('ff_user').value, $('ff_remotekey').value, response[0], onTwitterUserSuccess);
      }
    }
  }
}

function onFFSubscribeSuccess(response) {
  if (error_check(response)) { return; }
  $('subscribe_'+response[0]).writeAttribute('value', response[1]);
  $('subscribe_'+response[0]).disable();
  $('subscribe_'+response[0]).up('tr').removeClassName('newfriend');
  $('subscribe_'+response[0]).up('td').previous(1).removeClassName('newfriend');
}

function onTwitterUserSuccess(response) {
  if (response[0] == "error") { 
    $('follow_'+response[2]).writeAttribute('value', 'account invalid');
    $('follow_'+response[2]).disable();
  }
  else {
     $('friend_'+response[0]).update('<img border="0" src="#{url}" height="25" width="25"/> <a href="http://twitter.com/#{username}">#{name}<a/>'.interpolate({username: response[0], name: response[1], url: response[2]}));
  }
}

function onTwitterFollowSuccess(response) {
  if (error_check(response)) { return; }
  $('follow_'+response[0]).writeAttribute('value', response[1]);
  $('follow_'+response[0]).disable();
  $('row_'+response[0]).removeClassName('newfriend');
  $('friend_'+response[0]).removeClassName('newfriend');
}

function onInviteToFFSuccess(response) {
  if (error_check(response)) { return; }
  $('invite_'+response[0]).disable();
}



// Utility functions

function create_invitations() {
  rows = $$('tbody tr');
  for (var x = 1; x < rows.length; ++x) {
     if (rows[x].getElementsBySelector('td input').size() == 0) {
        rows[x].getElementsBySelector('td')[3].update('<input id="invite_#{twitter}" type="button" value="invite to FF" onClick="inviteToFF(\'#{twitter}\')"/>'.interpolate({twitter: friends[x-1]}));
     }
  }     
}

function toggle(id) { 
  $(id).toggle(); 
  $(id+'_link').update( ($(id).visible() ? '(hide)' : '(show)') ); 
}

function toggle_noop() {
  rows = $$('tbody tr');
  for (var x = 1; x < rows.length; ++x) {
     if (!rows[x].hasClassName('newfriend')) { rows[x].toggle(); }
  } 
}
