'use strict';

angular.module('copayApp.controllers').controller('preferencesUnitController', function($scope, $log, configService, $ionicHistory, gettextCatalog, walletService, profileService) {

  var config = configService.getSync();
  $scope.unitList = [{
    name: 'μFLM (1,000,000 μFLM = 1FLM)',
    shortName: 'μFLM',
    value: 100,
    decimals: 2,
    code: 'uflm',
  }, {
    name: 'FLM',
    shortName: 'FLM',
    value: 100000000,
    decimals: 8,
    code: 'flm',
  }];

  $scope.save = function(newUnit) {
    var opts = {
      wallet: {
        settings: {
          unitName: newUnit.shortName,
          unitToSatoshi: newUnit.value,
          unitDecimals: newUnit.decimals,
          unitCode: newUnit.code,
        }
      }
    };

    configService.set(opts, function(err) {
      if (err) $log.warn(err);

      $ionicHistory.goBack();
      walletService.updateRemotePreferences(profileService.getWallets())
    });
  };

  $scope.$on("$ionicView.enter", function(event, data){
    $scope.currentUnit = config.wallet.settings.unitCode;
  });
});
