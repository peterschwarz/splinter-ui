// Copyright 2019 Cargill Incorporated
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

mod errors;

use actix_http::Error as ActixError;
use actix_web::{middleware, web, App, HttpRequest, HttpResponse, HttpServer};
use futures::Future;
use std::boxed::Box;
use std::sync::{mpsc, Arc};
use std::thread;

pub use errors::RestApiServerError;

pub trait RestResourceProvider {
    fn resources(&self) -> Vec<Resource>;
}

type HandlerFunction = Box<
    dyn Fn(HttpRequest, web::Payload) -> Box<Future<Item = HttpResponse, Error = ActixError>>
        + Send
        + Sync
        + 'static,
>;

pub struct RestApiShutdownHandle {
    do_shutdown: Box<dyn Fn() -> Result<(), RestApiServerError> + Send>,
}

impl RestApiShutdownHandle {
    pub fn shutdown(&self) -> Result<(), RestApiServerError> {
        (*self.do_shutdown)()
    }
}

#[derive(Clone)]
pub enum Method {
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Head,
}

#[derive(Clone)]
pub struct Resource {
    route: String,
    method: Method,
    handle: Arc<HandlerFunction>,
}

impl Resource {
    pub fn new<F>(method: Method, route: &str, handle: F) -> Self
    where
        F: Fn(HttpRequest, web::Payload) -> Box<Future<Item = HttpResponse, Error = ActixError>>
            + Send
            + Sync
            + 'static
            + Clone,
    {
        Self {
            method,
            route: route.to_string(),
            handle: Arc::new(Box::new(handle)),
        }
    }

    fn into_route(self) -> actix_web::Resource {
        let method = self.method.clone();
        let path = self.route.clone();
        let func = move |r: HttpRequest, p: web::Payload| (self.handle)(r, p);

        let route = match method {
            Method::Get => web::get().to_async(func),
            Method::Post => web::post().to_async(func),
            Method::Put => web::put().to_async(func),
            Method::Patch => web::patch().to_async(func),
            Method::Delete => web::delete().to_async(func),
            Method::Head => web::head().to_async(func),
        };

        web::resource(&path).route(route)
    }
}

#[derive(Clone)]
pub struct RestApi {
    resources: Vec<Resource>,
    bind: String,
}

impl RestApi {
    pub fn run(
        self,
    ) -> Result<
        (
            RestApiShutdownHandle,
            thread::JoinHandle<Result<(), RestApiServerError>>,
        ),
        RestApiServerError,
    > {
        let bind_url = self.bind.to_owned();
        let (tx, rx) = mpsc::channel();

        let join_handle = thread::Builder::new()
            .name("SplinterDRestApi".into())
            .spawn(move || {
                let sys = actix::System::new("SplinterD-Rest-API");
                let addr = HttpServer::new(move || {
                    let mut app = App::new().wrap(middleware::Logger::default());

                    for resource in self.resources.clone() {
                        app = app.service(resource.into_route());
                    }
                    app
                })
                .bind(bind_url)?
                .disable_signals()
                .system_exit()
                .start();

                tx.send(addr).map_err(|err| {
                    RestApiServerError::StartUpError(format!("Unable to send Server Addr: {}", err))
                })?;
                sys.run()?;

                info!("Rest API terminating");

                Ok(())
            })?;

        let addr = rx.recv().map_err(|err| {
            RestApiServerError::StartUpError(format!("Unable to receive Server Addr: {}", err))
        })?;

        let do_shutdown = Box::new(move || {
            debug!("Shutting down Rest API");
            addr.stop(true);
            debug!("Graceful signal sent to Rest API");

            Ok(())
        });

        Ok((RestApiShutdownHandle { do_shutdown }, join_handle))
    }
}

pub struct RestApiBuilder {
    resources: Vec<Resource>,
    bind: Option<String>,
}

impl Default for RestApiBuilder {
    fn default() -> Self {
        Self {
            resources: Vec::new(),
            bind: None,
        }
    }
}

impl RestApiBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_bind(mut self, value: &str) -> Self {
        self.bind = Some(value.to_string());
        self
    }

    pub fn add_resource(mut self, value: Resource) -> Self {
        self.resources.push(value);
        self
    }

    pub fn add_resources(mut self, mut values: Vec<Resource>) -> Self {
        self.resources.append(&mut values);
        self
    }

    pub fn build(self) -> Result<RestApi, RestApiServerError> {
        let bind = self
            .bind
            .ok_or_else(|| RestApiServerError::MissingField("bind".to_string()))?;

        Ok(RestApi {
            bind,
            resources: self.resources,
        })
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use actix_http::Response;
    use futures::IntoFuture;

    #[test]
    fn test_create_handle() {
        let handler = Resource::new(Method::Get, "/test", |_: HttpRequest, _: web::Payload| {
            Box::new(Response::Ok().finish().into_future())
        });
    }
}