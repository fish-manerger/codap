// ==========================================================================
//                          DG.GameController
//
//  Copyright (c) 2014 by The Concord Consortium, Inc. All rights reserved.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
// ==========================================================================

/* globals iframePhone */
sc_require('controllers/component_controller');

/** @class
 *
 * The GameController manages a Component presumably containing a Data
 * Interactive.
 *
 * From CODAP's perspective a Data Interactive is a data source. It provides
 * data to an associated Data Context.
 *
 * It receives events from the interactive and acts upon them. Chiefly these
 * are events that create or update case data in collections managed by its
 * data context.
 *
 * @extends DG.ComponentController
*/
DG.GameController = DG.ComponentController.extend(
/** @scope DG.GameController.prototype */ {

      shouldConfirmClose: function () {
        return !SC.none(this.activeChannel);
      }.property('activeChannel'),

      confirmCloseDescription: 'DG.GameController.confirmCloseDescription',

      shouldDestroyOnComponentDestroy: true,

      gameIsReady: true,  // Will be set to false at the point we discover we're
                          // going to have a default game loaded

      /**
       * Every game manages directly a default GameContext. A game context knows
       * basic information about the game and has collections and the namespace
       * for the game to store its data into.
       *
       * @property {DG.GameContext}
       */
      contextBinding: '.model.context',

      /**
       The total number of document-dirtying changes.
       @property   {Number}
       */
      changeCount: 0,

      /**
       The number of document-dirtying changes that have been saved.
       If this is less than the total change count, then the document is dirty.
       @property   {Number}
       */
      savedChangeCount: 0,

      /**
       Whether or not the document contains unsaved changes such that the user
       should be prompted to confirm when closing the document, for instance.
       @property   {Boolean}
       */
      hasUnsavedChanges: function() {
        return this.get('changeCount') > this.get('savedChangeCount');
      }.property(),

      /**
       Synchronize the saved change count with the full change count.
       This method should be called when a save occurs, for instance.
       */
      updateSavedChangeCount: function() {
        this.set('savedChangeCount', this.get('changeCount'));
      },

      /**
       * If false, permit the data interactive to participate in normal component
       * selection, including coming to the front.
       * @type {boolean}
       */
      preventBringToFront: true,

      /**
       * If true, prevent collection reorganization for this data interactive's
       * data context.
       *
       */
      preventDataContextReorg: true,

      init: function () {
        sc_super();
        this.gamePhoneHandler = DG.GamePhoneHandler.create({
          controller: this
        });
        this.dataInteractivePhoneHandler = DG.DataInteractivePhoneHandler.create({
          controller: this,
        });
        this.gamePhoneHandler.addObserver('connected', this, 'connectionDidChange');
        this.dataInteractivePhoneHandler.addObserver('connected', this, 'connectionDidChange');
      },

      /**
       * Break loops
       */
      destroy: function() {
        this.setPath('model.content', null);
        this.removeObserver('gamePhoneHandler.connected', this, 'connectionDidChange');
        this.removeObserver('dataInteractivePhoneHandler.connected', this, 'connectionDidChange');
        if (this.gamePhoneHandler) {
          this.gamePhoneHandler.destroy();
          this.gamePhoneHandler = null;
        }
        if (this.dataInteractivePhoneHandler) {
          this.dataInteractivePhoneHandler.destroy();
          this.dataInteractivePhoneHandler = null;
        }
        if (this.iframePhoneEndpoint) {
          this.iframePhoneEndpoint.disconnect();
        }
        sc_super();
      },

      /**
       * The Parent Endpoint for the iFramePhone connection to the data interactive.
       * @property {i
       */
      iframePhoneEndpoint: null,

      /**
       * Handles the old-style 'game' API using async iframePhone post-messaging
       * @property {DG.GamePhoneHandler}
       */
      gamePhoneHandler: null,

      /**
       * Handles the new-style 'data interactive' API using async iframePhone post-messaging
       * Brought into existence in March, 2016
       * @property {DG.DataInteractivePhoneHandler}
       */
      dataInteractivePhoneHandler: null,

      /**
       * Return the phone handler that is connected. (Only one should be connected.)
       * @property { DG.DataInteractivePhoneHandler | DG.GamePhoneHandler }
       */
      activeChannel: function () {
        if (this.dataInteractivePhoneHandler.get('connected')) {
          return this.dataInteractivePhoneHandler;
        } else if (this.gamePhoneHandler.get('connected')) {
          return this.gamePhoneHandler;
        }
      }.property(),

      /**
       * @property {Boolean}
       */
      isUsingDataInteractiveChannel: function() {
        return this.get('activeChannel') === this.dataInteractivePhoneHandler;
      }.property('activeChannel'),

      connectionDidChange: function () {
        this.notifyPropertyChange('activeChannel');
      },

      setUpChannels: function (iFrame, iUrl) {
        var setupHandler = function (iHandler, iKey) {
          var wrapper = function (command, callback) {
            iHandler.set('isPhoneInUse', true);
            iHandler.doCommand(command, function (ret) {
              DG.doCommandResponseHandler(ret, callback);
            });
          };

          //First discontinue listening to old interactive.
          if (iHandler.rpcEndpoint) {
            iHandler.rpcEndpoint.disconnect();
          }

          // Global flag used to indicate whether calls to application should be made via phone, or not.
          iHandler.set('isPhoneInUse', false);

          iHandler.rpcEndpoint = new iframePhone.IframePhoneRpcEndpoint(wrapper.bind(this),
              iKey, iFrame, this.extractOrigin(iUrl), this.iframePhoneEndpoint);
          // Let games/interactives know that they are talking to CODAP, specifically (rather than any
          // old iframePhone supporting page) and can use its API.
          iHandler.rpcEndpoint.call({message: "codap-present"}, function (reply) {
            DG.log('Got codap-present reply on channel: "' + iKey + '": ' + JSON.stringify(reply));
            // success or failure, getting a reply indicates we are connected
          });
        }.bind( this);

        // We create a parent endpoint. The rpc endpoints will live within
        // the raw parent endpoint.
        this.iframePhoneEndpoint = new iframePhone.ParentEndpoint(iFrame,
            this.extractOrigin(iUrl), function () {DG.log('connected');});
        setupHandler(this.get('gamePhoneHandler'), 'codap-game');
        setupHandler(this.get('dataInteractivePhoneHandler'), 'data-interactive');
      },

      /**
       * If the URL is a web URL return the origin.
       *
       * The origin is scheme://domain_name.port
       */
      extractOrigin: function (url) {
        var re = /([^:]*:\/\/[^\/]*)/;
        if (/^http.*/i.test(url)) {
          return re.exec(url)[1];
        }
      },


      gameViewWillClose: function() {
      },

      /**
       * Saves the current state of the DataInteractive (if the DataInteractive supports this).
       *
       * This should be assumed to be asynchronous, as it will generally use iFramePhone,
       * although it's possible for it to return synchronously.
       *
       * @param {Function} callback     A function which will be called with a results object:
       * {success: bool, state: state}
       */
      saveGameState: function (callback) {
        var dataInteractiveHandler = this.get('dataInteractivePhoneHandler');
        var gamePhoneHandler = this.get('gamePhoneHandler');
        if (dataInteractiveHandler && dataInteractiveHandler.get('connected')) {
          dataInteractiveHandler.requestDataInteractiveState(callback);
        } else if (gamePhoneHandler && gamePhoneHandler.get('gameIsReady')) {
          gamePhoneHandler.saveGameState(callback);
        } else {
          callback({success: false, state: null});
        }
      },

      /**
       *  Returns an object that should be stored with the document when the document is saved.
       *  @returns  {Object}  An object whose properties should be stored with the document.
       */
      createComponentStorage: function () {
        var tStorage = this.getPath('model.componentStorage');

        if (!SC.none(this.context)) {
          // Save information about the current game
          tStorage.currentGameName = tStorage.currentGameName || this.getPath('context.gameName');
          tStorage.currentGameUrl = tStorage.currentGameUrl || this.getPath('context.gameUrl');
        }

        var dataContext = this.get('context');

        if (dataContext && !this.getLinkID(tStorage, 'context')) {
          this.addLink(tStorage, 'context', dataContext);
        }

        // Save any user-created formulas from DG.FormulaObjects.
        // Currently, only formulas from the current game are saved.
        // Eventually, the formulas should be stored with the DG.GameContext
        // and they should be saved for any game in which formulas are defined.
        tStorage.currentGameFormulas = SC.clone(this.getPath('context.formulas'));

        return tStorage;
      },

      /**
       *  Restores the properties of the DG.GamePhoneHandler from the specified Object.
       *  @param  {Object}  iComponentStorage -- The object whose properties should be restored.
       *  @param  {String}  iDocumentID -- The ID of the document being restored.
       */
      restoreComponentStorage: function (iComponentStorage, iDocumentID) {
        var gameName = iComponentStorage.currentGameName,
            gameUrl = iComponentStorage.currentGameUrl,
            contextID,
            dataContext;


        // We try to hook up the appropriate restored context.
        // Try to restore the data context for the current game.
        // First, see if it was written out with the document.
        // (Writing out the link began in build 0175.)
        contextID = this.getLinkID(iComponentStorage, 'context');
        dataContext = contextID && DG.currDocumentController().getContextByID(contextID);
        if (!dataContext) {
          // If it wasn't written out with the document, look for one
          // associated with a game of the correct name, or for the
          // first context as a last resort.
          DG.currDocumentController().contexts.forEach(function (iContext) {
            // Look for a context with matching game name.
            // Note that at the moment, 'gameName' is a computed
            // property which relies on the 'gameSpec' property
            // having been set, which is unlikely to have occurred
            // given that the gameSpec doesn't know about the context.
            // This could change down the road, however, so we leave it.
            if (!dataContext && iContext) {
              var contextGameName = iContext.get('gameName');
              if (contextGameName === gameName) {
                dataContext = iContext;
              }
            }
          });
        }
        if (dataContext) {
          this.set('context', dataContext);
          this.setPath('context.gameName', gameName);
          this.setPath('context.gameUrl', gameUrl);
        }

        // If there are user-created formulas to restore, set them in the
        // gameSpec.
        if (dataContext && iComponentStorage.currentGameFormulas)
          dataContext.set('formulas', iComponentStorage.currentGameFormulas);

        this.set('gameIsReady', true);
      }
    }) ;


/**
 * This entry point allows other parts of the code to send arbitrary notifications
 * to all DataInteractives currently running. The notification should be as defined
 * in https://github.com/concord-consortium/codap/wiki/CODAP-Data-Interactive-API#codap-initiated-actions.
 * If supported for the Game API (https://github.com/concord-consortium/codap/wiki/CODAP-Game-API-(Deprecated))
 * and the Data Interactive has connected through that channel, it will convert the
 * notification and issue it. Otherwise it will not send the command.
 *
 * No monitoring of the actual receipt of the notification is possible through
 * this method. It is possible that the notifications will be made and fail on the
 * DI side.
 *
 * @param iCmd       An object representing the command to be send
 * @return the number of DataInteractives that the event was issued to.
 */
DG.sendCommandToDI = function( iCmd) {
  function translateNotification(notification) {
    if (notification && notification.resource === 'undoChangeNotice') {
      return {operation: notification.values.operation};
    }
  }
  var controllers = DG.currDocumentController().get('dataInteractives');
  var gameNotification = null;
  controllers.forEach(function (controller) {
    var name = controller.getPath('view.title');
    var activeChannel = controller.get('activeChannel');
    var gamePhoneHandler = controller.get('gamePhoneHandler');
    function handleResponse(response) {
      //if (!response || !response.success) {
        //DG.log('Data Interactive Notification to %@ failed: %@'.loc(name, JSON.stringify(iCmd)));
      //}
    }
    if (activeChannel === gamePhoneHandler) {
      if (!gameNotification) {
        gameNotification = translateNotification(iCmd);
      }
      activeChannel.rpcEndpoint.call(gameNotification, handleResponse);
      DG.log('sendCommandToDI: sent game notification to %@: %@'.loc(name, JSON.stringify(gameNotification)));
    } else if (activeChannel) {
      activeChannel.rpcEndpoint.call(iCmd, handleResponse);
      DG.log('sendCommandToDI: sent notification to %@: %@'.loc(name, JSON.stringify(iCmd)));
    }
  });
};

