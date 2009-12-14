#!/usr/bin/env python
#
# Copyright 2007 Google Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

import wsgiref.handlers
import sys
import os
import logging
import twitter
import friendfeed

from django.utils import simplejson
from google.appengine.ext import webapp
from google.appengine.ext.webapp import template
from google.appengine.ext.webapp import util
from google.appengine.api import memcache

from google.appengine.ext import db

class TwitterUser(db.Model):
  username = db.StringProperty(required=True)
  name = db.StringProperty()
  image_url = db.StringProperty()
  date = db.DateTimeProperty(auto_now_add=True)

class FFUser(db.Model):
  nickname = db.StringProperty(required=True)
  name = db.StringProperty()
  date = db.DateTimeProperty(auto_now_add=True)
  t_username = db.StringProperty()

class MainHandler(webapp.RequestHandler):

  def get(self):
    path = os.path.join(os.path.dirname(__file__), 'index.html')
    self.response.out.write(template.render(path, {}))

class ClearHandler(webapp.RequestHandler):
  def get(self):
    q = TwitterUser.all()
    results = q.fetch(int(self.request.get("limit")))
    ts = len(results)
    db.delete(results)

    q = FFUser.all()
    results = q.fetch(int(self.request.get("limit")))
    fs = len(results)
    db.delete(results)
    self.response.out.write("t="+str(ts)+",ff="+str(fs))

class RPCHandler(webapp.RequestHandler):
  """ Allows the functions defined in the RPCMethods class to be RPCed."""
  def __init__(self):
    webapp.RequestHandler.__init__(self)
    self.methods = RPCMethods()
 
  def get(self):
    func = None
   
    action = self.request.get('action')
    if action:
      if action[0] == '_':
        self.error(403) # access denied
        return
      else:
        func = getattr(self.methods, action, None)
   
    if not func:
      self.error(404) # file not found
      return
     
    args = ()
    while True:
      key = 'arg%d' % len(args)
      val = self.request.get(key)
      if val:
        args += (simplejson.loads(val),)
      else:
        break
    result = func(*args)
    self.response.out.write(simplejson.dumps(result))

  def post(self):
    args = simplejson.loads(self.request.body)
    func, args = args[0], args[1:]
   
    if func[0] == '_':
      self.error(403) # access denied
      return
     
    func = getattr(self.methods, func, None)
    if not func:
      self.error(404) # file not found
      return

    result = func(*args)
    self.response.out.write(simplejson.dumps(result))


class RPCMethods:
  """ Defines the methods that can be RPCed.
  NOTE: Do not allow remote callers access to private/protected "_*" methods.
  """

  # Get friends from Twitter (100 at-a-time via the page parameter)  
  def TwitterFriends(self, *args):
    try:
       t_api = twitter.Api(username=args[0],password=args[1])
       t_friends = t_api.GetFriends()
       for f in t_friends:
          t = TwitterUser(key_name='twitter_'+f.screen_name.lower(),username=f.screen_name.lower(),name=f.name,image_url=f.profile_image_url)
          if memcache.get(t.key().name()) is None:
             logging.debug("inserting into memcache twitter=" + t.username)
             memcache.add(t.key().name(), t)          
             if TwitterUser.get_by_key_name(t.key().name()) == None:
               logging.debug("inserting into DB twitter=" + t.username)
               t.put()       
    except AttributeError:
       logging.error(sys.exc_info())
       return ['error', 'Error: are you sure your log-in is correct?']
    except:
       logging.error('Failed to fetch friends for t='+args[0])
       logging.error(sys.exc_info())
       return ['error', 'Unknown Error']
     
    return [args[2]] + [(f.screen_name.lower(), f.name, f.profile_image_url) for f in t_friends]
    
  # Get subscriptions from FF  
  def FFSubscriptions(self, *args):
    retval = []
    try:
      ff_api = friendfeed.FriendFeed(args[0], args[1])
      ff_user = ff_api.fetch_user_profile(args[0])
      if not ff_user.has_key('subscriptions'):
        return ['error', 'Error: are you sure your remote key is correct?']
      for sub in ff_user['subscriptions']:
         if sub['nickname'] != None:
            retval.append([sub['nickname'], sub['name']])
    except:
      logging.error('Failed to fetch profile/subscriptions for ff='+args[0])
      logging.error(sys.exc_info())
      return ['error', 'Unknown Error']
      
    return retval

  # I had to give up on this due to:
  # 1) Lists of nicknames that are too long (leading to an invalid URL)
  # 2) DeadlineErrors from GAE
  #
  #def FFSearch(self, *args):
  #  retval = []
  #  ff_profiles = 'uninitialized'
  #  
  #  q = TwitterUser.gql("WHERE username IN :1", args[2])
  #  for t in q:
  #    if t != None and t.ffuser_set.count() > 0:
  #      ff = t.ffuser_set.get()
  #      retval.append((t.username, ff.nickname, ff.name, True))
  #      args[2].remove(t.username)
  #  
  #  try:
  #    ff_api = friendfeed.FriendFeed(args[0], args[1])
  #    ff_profiles = ff_api.fetch_user_profiles(args[2])    
  #    for profile in ff_profiles['profiles']:
  #       verified = False
  #       for s in profile['services']:
  #          if s['id'] == 'twitter' and s.has_key('username') and (s['username'].lower() == profile['nickname'] or args[3] == 'override'):
  #             verified = True
  #             break
  #
  #       retval.append((profile['nickname'], profile['nickname'], profile['name'], verified))
  #  except:
  #     logging.info('Failed to fetch profiles of ffs='+','.join(args[2]))
  #     logging.info(sys.exc_info())
  #     return ['error', 'error']
  #  
  #  return retval

  def FFProfile(self, *args):
    retval = []
    verified = False
    ff_key = 'ff_'+args[2]
    
    # the override tells us we've passed in a FF nickname, so if a Twitter id is found, just return it
    if args[3] == 'override': 
      t_user = ''
      ff = memcache.get(ff_key)
      if ff is None:
        ff = FFUser.get_by_key_name(ff_key)
        if ff is not None: logging.info("got ff=" + args[2] + " from DB")
      else: logging.info("got ff=" + args[2] + " from memcache")
    else: 
      t_user = args[2]
      ff = FFUser.gql("WHERE t_username = :1", args[2]).get()


    # if FF account is in DB, return FF account (optionally linked to a Twitter account)
    if ff != None:
      if ff.t_username != None: 
        t_user = ff.t_username
        verified = True
      retval = [t_user, ff.nickname, ff.name, verified]
    else:
      try:
        ff_api = friendfeed.FriendFeed(args[0], args[1])
        ff_profile = ff_api.fetch_user_profile(args[2])    
        if ff_profile.has_key('services'):
          for s in ff_profile['services']:
            if s['id'] == 'twitter' and s.has_key('username') and (s['username'].lower() == ff_profile['nickname'] or args[3] == 'override'):
              verified = True
              t_user = s['username'].lower()
              break  
          ff = FFUser(key_name='ff_'+ff_profile['nickname'],nickname=ff_profile['nickname'],name=ff_profile['name'])
          if verified:
             t = memcache.get('twitter_'+t_user)
             if t is None:
                t = TwitterUser.get_by_key_name('twitter_'+t_user)
             if t is None:
               # should I be doing this???? are these twitter accounts verified??
               TwitterUser(key_name='twitter_'+t_user,username=t_user).put()
               ff.t_username = t_user
             else:
               ff.t_username = t.username
          ff.put()
          memcache.add(ff_key, ff)
          retval = [t_user, ff_profile['nickname'], ff_profile['name'], verified]
        else:
          logging.debug('No account for ff='+args[2])
          retval = ['error', 'no such FF with nickname='+args[2]]
      except:
         logging.info('Failed to fetch profile of ff='+args[2])
         logging.info(sys.exc_info())
         return ['error', 'error']
    
    return retval

  def FFSubscribe(self, *args):
    retval = []
    try:
      ff_api = friendfeed.FriendFeed(args[0], args[1])
      val = ff_api.user_subscribe(args[2])
      if val.has_key('errorCode'):
         logging.info('FF returned errorCode= '+val['errorCode'])
         retval = ['error', 'Failed to subscribe to '+args[2]+': '+val['errorCode']]
      else:
         logging.debug('Success: '+args[2]+'='+val['status'])
         retval = [args[2], val['status']]
    except:
      logging.error('Unknown error subscribing to '+args[2])
      logging.info(sys.exc_info())
      retval = ['error', 'Unknown error subscribing to '+args[2]+' (try again)']
      
    return retval

  def TwitterUser(self, *args):
    user = 'uninitialized'
    key = 'twitter_'+args[2]
    try:
      t = memcache.get(key)
      if t is not None:
         logging.debug("Got twitter=" + args[2] + " from the memcache")
         return [t.username, t.name, t.image_url]
         
      t = TwitterUser.get_by_key_name(key)
      if t == None or t.name == None:
         t_api = twitter.Api(username=args[0],password=args[1])
         user = t_api.GetUser(args[2])         
         if t == None:
            logging.debug("inserting into DB twitter=" + user.screen_name.lower())
            t = TwitterUser(key_name=key,username=user.screen_name.lower(),name=user.name,image_url=user.profile_image_url)
            t.put()
         else:
            t.name = user.screen_name.lower()
            t.image_url = user.profile_image_url
            t.put()
         logging.debug("inserting into memcache twitter=" + user.screen_name.lower())
         memcache.add(key, t)
         retval = [t.username, t.name, t.image_url]
      else:
         logging.debug("Got twitter=" + args[2] + " from the DB")
         retval = [t.username, t.name, t.image_url]
    except:
      logging.info('Could not find Twitter account with username ' + args[2])
      logging.info(sys.exc_info())
      return ['error', 'Could not find Twitter account with username ' + args[2], args[2]]
    
    return retval 
    
  def TwitterFollow(self, *args):
    try:
      t_api = twitter.Api(username=args[0],password=args[1])
      t_api.CreateFriendship(args[2])
      logging.debug('Success: following='+args[2])
    except:
       logging.info('Error trying to follow '+args[2])
       logging.info(sys.exc_info())
       return ['error', 'Unknown error trying to follow '+args[2]+' (try again)']
    
    return [args[2], "following"]

  def InviteToFF(self, *args):
    try:
      t_api = twitter.Api(username=args[0],password=args[1])
      x = t_api.PostDirectMessage(args[2], args[3])
      if x.text is None:
        t_api.PostUpdate('@'+args[2]+' '+args[3])  
    except:
       logging.error('Error trying to DM/tweet')
       logging.info(sys.exc_info())
       return ['error', 'Error trying to DM/tweet']
    
    return [args[2], "success"]


#  def UpdateStatus(self, *args):
#    try:
#      t_api = twitter.Api(username=args[0],password=args[1])
#      t_api.PostUpdate(args[3])
#    except:
#       logging.error('Error trying to tweet')
#       logging.info(sys.exc_info())
#       return ['error', 'Error trying to tweet']
#    
#    return [args[2], "success"]

def main():
  application = webapp.WSGIApplication([
     ('/', MainHandler),
     ('/clear', ClearHandler),
     ('/rpc', RPCHandler)],
     debug=True)
  wsgiref.handlers.CGIHandler().run(application)


if __name__ == '__main__':
  main()
