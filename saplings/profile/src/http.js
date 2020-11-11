/**
 * Copyright 2018-2020 Cargill Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Wrapper function to set up fetch requests.
 * @param {string}      method    HTTP method for the request
 * @param {string}      url       endpoint to make the request to
 * @param {object}      data      Byte array representation of the request body
 * @param {object}      headers   optional set of request headers
 */

function HttpClient(token) {
  console.log(`*** constructed with token ${token} ***`);
  this.token = token;
}

HttpClient.prototype.http = function http(method, url, data, headers) {
  console.log(`*** ${method} ${url} ***`);

  fetch(url, {
    method,
    body: data,
    headers: {
      ...headers,
      Authorization: `Bearer ${this.token}`
    },
    credentials: 'include'
  })
  .catch((e) => {
    console.log('wtf', e);
    throw e;
  })
  .then((response) => Promise.all([response, response.ejson()]))
  .then(([response, json]) => {
    console.log(`*** ${method} ${url} ${response.ok ? 'OK' : response.status} ***`);
    if (!response.ok) {
      throw {
        ...json,
        // alias status
        code: response.status,
        status: response.status,
      };
    }
    return {
      // alias status
      code: response.status,
      status: response.status,
      data: json
    };
  })
}

HttpClient.prototype.get = function get(url, headers = {}) {
  return this.http('GET', url, null, headers);
}

HttpClient.prototype.post = function post(url, data, headers = {}) {
  return this.http('POST', url, data, headers);
}

HttpClient.prototype.put = function put(url, data, headers = {}) {
  return this.http('PUT', url, data, headers);
}

HttpClient.prototype.patch = function patch(url, data, headers = {}) {
  return this.http('PATCH', url, data, headers);
}

HttpClient.prototype.del = function del(url, headers = {}) {
  return this.http('DELETE', url, null, headers);
}
