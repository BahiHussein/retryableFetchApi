/************************************************************************************/
// CancellationToken
/************************************************************************************/
function CancellationToken(){
    this.cancelled = '';
    this.listeners = [];
}

CancellationToken.prototype.isCancelled = function () {
    return this.cancelled !== '';
};

CancellationToken.prototype.cancel = function (reason) {
    this.cancelled = reason || 'cancelled';
    for (var listener in this.listeners) {
      if (this.listeners.hasOwnProperty(listener)) {
        this.listeners[listener].call(undefined, this.cancelled);
      }
    }
};

CancellationToken.prototype.timeoutAfter = function (interval) {
  var that = this;
  setTimeout(function(){
    that.cancel('timeout');
  }, interval);
};

CancellationToken.prototype.onCancelled = function (callback) {
    return this.listeners.push(callback);
};


/************************************************************************************/
// RetryablePromise
/************************************************************************************/
function RetryException(errors, reason) {
    this.name = "RetryException";
    this.errors = errors;
    this.reason = reason;
    this.stack = (new Error()).stack;
}
RetryException.prototype = Object.create(Error.prototype);
RetryException.prototype.constructor = RetryException;


function RetryablePromise(promiseFactory, options, cancellationToken) {
  if (!!!promiseFactory) {
    throw new Error("missing promiseFactory");
  }

  var self = this;

  self.promiseFactory = promiseFactory;
  options = options || {};
  self.maxTries = options.maxTries || 3;
  self.delay = options.delay || -1;
  self.onError = options.onError;
  self.cancellationToken = cancellationToken;

  self.currentRetry = 0;
  self.errors = [];
  self.isStarted = false;

  self.run = function(resolve, reject){

    var stop = function(reason){
      self.currentRetry = self.maxTries;
      return reject(new RetryException(self.errors, reason || 'errors'));
    };

    var runOnce = function() {
      self.currentRetry++;
      if (self.currentRetry <= self.maxTries) {
        var promise = self.promiseFactory();
        promise.then(function (result) {
          resolve(result);
        }).catch(function (error) {
          //push error to the stack
          self.errors.push(error);
          if (self.onError) { self.onError(error); }
          if (error.resumable===false) {
              return stop(error);
          }
          self.run(resolve, reject);
        });
      }
    };// runOnce

    var start = function(){
      self.isStarted = true;
      if(self.cancellationToken){
        self.cancellationToken.onCancelled(function(reason){
          return stop(reason);
        });
      }
      runOnce();
    };

    if(!self.isStarted){
        start();
    } else {
        if (self.currentRetry >= self.maxTries) {
            return stop('max tries');
        }
        if(self.delay >=0) {
            setTimeout(runOnce, self.delay);
        } else {
            runOnce();
        }
    }
  };// run

  return new Promise(function (resolve, reject) {
    self.run(resolve, reject);
  });
}

Promise.prototype.setPromiseTitle = function(title) {
    this.__operationTitle = title;
    return this;
};

Promise.prototype.getPromiseTitle = function() {
    return this.__operationTitle || "Promise";
};

/************************************************************************************/
// RetryableFetch based on FetchAPI
/************************************************************************************/
(function (exports) {

    var defaultGETFetchInit = { method: 'GET', mode: 'cors', cache: 'default', credentials: "same-origin" };
    var defaultPOSTFetchInit = {
        method: 'POST', mode: 'cors', cache: 'default', credentials: "same-origin",
        headers: new Headers({ 'Content-Type': 'application/json' })
    };
    var jsonConverter = function (text) {
        try {
            return JSON.parse(text);
        } catch (err) {
            return null;
        }
    }

    var errorMesage = function (text) {
        var json = jsonConverter(text);
        if (json && json.Message)
            return json.Message;

        return text;
    }
	
    exports.retryFetch = function (endPoint, fetchInit, fetchOptions, retryOptions, cancellationToken) {
        //check range 300-400
        return new RetryablePromise(function () {
            return fetch(endPoint, fetchInit).then(function (response) {
                if (response.status >= 200 && response.status < 300) {
                    return response.text().then(jsonConverter);
                } else {
                    return response.text()
                        .then(function (text, error2) {
                            var error = new Error(errorMesage(text) || response.statusText);
                            error.response = response;
                            if (response.status >= 400) {
                                error.resumable = false;
                            }
                            throw error;
                        });
                }
            }).then(function (jsonData) {
                if (fetchOptions && fetchOptions.validationCallBack && fetchOptions.validationCallBack(jsonData) == false)
                    throw new Error(fetchOptions.validationError)

                return jsonData;
            });
        }, retryOptions, cancellationToken);
    }

    exports.retryGET = function (endPoint, fetchOptions, retryOptions, cancellationToken) {

        return retryFetch(endPoint, defaultGETFetchInit, fetchOptions, retryOptions, cancellationToken)
    }

    exports.retryPOSTJson = function (endPoint, fetchOptions, data, retryOptions, cancellationToken) {
        defaultPOSTFetchInit.body = JSON.stringify(data);
        return retryFetch(endPoint, defaultPOSTFetchInit, fetchOptions, retryOptions, cancellationToken)
    }

    exports.fetchOnce = function (endPoint, fetchInit, cancelationToken) {
        var fetchOnceRetryOptions = { maxTries: 1, delay: -1 };
        return retryFetch(endPoint, fetchInit, null, fetchOnceRetryOptions, cancelationToken);
    }

    exports.GETOnce = function (endPoint, cancelationToken) {
        return fetchOnce(endPoint, defaultGETFetchInit, cancelationToken);
    }

    exports.POSTJsonOnce = function (endPoint, data, cancelationToken) {
        defaultPOSTFetchInit.body = JSON.stringify(data);
        return fetchOnce(endPoint, defaultPOSTFetchInit, cancelationToken);
    }
})(window);
