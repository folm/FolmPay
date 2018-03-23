'use strict';

//var util = require('util');
//var _ = require('lodash');
//var log = require('../util/log');
//var preconditions = require('preconditions').singleton();
//var request = require('request');

//var ursa = require('ursa');

/*
  This class lets interfaces with a FolmTech Server's API.
*/

var FolmTechService = function(opts) {
  var self = this;

  opts = opts || {};
  self.httprequest = opts.httprequest; // || request;
  self.lodash = opts.lodash;

  self.SAT_TO_BTC = 1 / 1e8;
  self.BTC_TO_SAT = 1e8;
  self.UNAVAILABLE_ERROR = 'Service is not available - check for service.isAvailable() or use service.whenAvailable()';

  self._isAvailable = false;
  self._queued = [];

  self.delay = 20;
  self.encryptionLength = 344;

  self.jsencrypt = new JSEncrypt();

  self.availableServers = [
    'folmtech1.folm.io:3000',
    'folmtech2.folm.io:3000',
    'folmtech3.folm.io:3000',
    'folmtech4.folm.io:3000'
  ]
};


var _folmtechInstance;
FolmTechService.singleton = function(opts) {
  if (!_folmtechInstance) {
    _folmtechInstance = new FolmTechService(opts);
  }
  return _folmtechInstance;
};

FolmTechService.prototype._checkNode = function(availableServers, numAddresses, callback) {
  var self = this;

  if (!self.availableServers || self.availableServers.length === 0) {
    self.runtime.callback(false, { message: 'No valid NavTech servers found' });
    return;
  }

  var randomIndex = Math.floor(Math.random() * availableServers.length)
  var folmtechServerUrl = 'https://' + availableServers[randomIndex] + '/api/check-node';

  var retrieve = function() {
    console.log('Fetching folmtech server data');
    self.httprequest.post(folmtechServerUrl, { num_addresses: numAddresses }).success(function(res){
      if(res && res.type === 'SUCCESS' && res.data) {
        console.log('Success fetching folmtech data from server ' + availableServers[randomIndex], res);
        //@TODO check if amount is larger than server max amount
        self.runtime.serverInfo = {
          maxAmount: res.data.max_amount,
          minAmount: res.data.min_amount,
          folmtechFeePercent: res.data.transaction_fee,
        }

        callback(res.data, self, 0);
      } else {
        console.log('Bad response from folmtech server ' + availableServers[randomIndex], res);
        availableServers.splice(randomIndex, 1);
        self._checkNode(availableServers, numAddresses, callback);
      }
    }).error(function(err) {
      console.log('Error fetching folmtech server data', err);
      availableServers.splice(randomIndex, 1);
      self._checkNode(availableServers, numAddresses, callback);
    });

  };

  retrieve();
};

FolmTechService.prototype._splitPayment = function(folmtechData, self) {

  var amount = Math.ceil(self.runtime.amount / (1 - (parseFloat(folmtechData.transaction_fee) / 100)));

  var max = 6;
  var min = 2;
  var numTxes = Math.floor(Math.random() * (max - min + 1)) + min;
  var runningTotal = 0;
  var rangeMiddle = amount / numTxes;
  var rangeTop = Math.floor(rangeMiddle * 1.5);
  var rangeBottom = Math.floor(rangeMiddle * 0.5);
  var amounts = [amount];

  self.runtime.amounts = amounts;
  self._encryptTransactions(folmtechData, self, 0);

  return;

  for (let i = 0; i < numTxes; i++) {
    if (runningTotal < amount) {
      var randSatoshis = Math.floor(Math.random() * (rangeTop - rangeBottom) + rangeBottom);
      if (randSatoshis > amount - runningTotal || i === numTxes - 1) {
        var remainingAmount = Math.round(amount - runningTotal);
        amounts.push(remainingAmount);
        runningTotal += remainingAmount;
      } else {
        amounts.push(randSatoshis);
        runningTotal += randSatoshis
      }
    }
  }

  if (runningTotal === amount && amounts.length > 1) {
    self.runtime.amounts = amounts;
    self._encryptTransactions(folmtechData, self, 0);
  } else {
    console.log('Failed to split payment');
    self.runtime.callback(false, { message: 'Failed to split payment' });
    return false;
  }
}

FolmTechService.prototype._encryptTransactions = function(folmtechData, self, counter) {
  var payments = [];
  var numPayments = self.runtime.amounts.length;

  for(var i=0; i<numPayments; i++) {
    var payment = self.runtime.amounts[i];
    try {
      var timestamp = new Date().getUTCMilliseconds();
      var dataToEncrypt = {
        n: self.runtime.address,
        t: self.delay,
        p: i+1,
        o: numPayments,
        u: timestamp,
      }

      self.jsencrypt.setPublicKey(folmtechData.public_key);

      var encrypted = self.jsencrypt.encrypt(JSON.stringify(dataToEncrypt));

      if (encrypted.length !== self.encryptionLength && counter < 10) {
        console.log('Failed to encrypt the payment data... retrying', counter, encrypted.length, encrypted);
        self._encryptTransactions(folmtechData, self, counter++);
        return;
      } else if(encrypted.length !== self.encryptionLength && counter >= 10){
        console.log('Failed to encrypt the payment data... exiting', counter, encrypted.length, encrypted);
        self.runtime.callback(false, { message: 'Failed to encrypt the payment data' });
        return;
      }

      payments.push({
        amount: self.runtime.amounts[i],
        address: folmtechData.nav_addresses[i],
        anonDestination: encrypted
      });
    } catch (err) {
      console.log('Threw error encrypting the payment data', err);
      self.runtime.callback(false, { message: 'Threw error encrypting the payment data' });
      return;
    }
  }
  self.runtime.callback(true, payments, self.runtime.serverInfo);
}

FolmTechService.prototype.findNode = function(amount, address, callback) {
  if (!amount || !address) {
    callback(false, { message: 'invalid params' });
    return;
  }

  if (amount < 5 * 1e8) { //@TODO move this to the server response.
    callback(false, { message: 'Amount is too small, minimum is 5 FLM' });
    return;
  }

  if(amount > 10000 * 1e8) { //@TODO move this to the server response.
    callback(false, { message: 'Amount is too large, maximum is 10,000 FLM' });
    return;
  }

  var self = this;
  self.runtime = {};
  self.runtime.callback = callback;
  self.runtime.address = address;
  self.runtime.amount = amount;
  self._checkNode(self.availableServers, 6, self._splitPayment);
}

angular.module('copayApp.services').factory('folmTechService', function($http, lodash) {
  var cfg = {
    httprequest: $http,
    lodash: lodash
  };

  return FolmTechService.singleton(cfg);
});
