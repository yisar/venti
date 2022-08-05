export async function startWss() {
  this.wss = new WebSocket.Server({
    port: 5678,
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
        level: 3,
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024,
      },
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      serverMaxWindowBits: 10,
      concurrencyLimit: 10,
      threshold: 1024,
    },
  })
}

export async function startServer() {
  const server = express()
  server.use(express.urlencoded({ extended: true }))

  const dirname = new URL('.', import.meta.url).pathname
  server.get(/\.(css|js)$/, express.static(`${dirname}../dist/client`))

  const clientManifest = Object.entries(manifest).reduce(
    (acc, [k, v]) =>
      Object.assign(acc, {
        [k]: {
          ...v,
          loader: undefined,
          hasAction: typeof v.action === 'function',
          hasLoader: typeof v.loader === 'function',
        },
      }),
    {}
  )

  server.all('*', async (req, res, next) => {
    function getAncestorRoutes(route) {
      if (!route.parent) {
        return [route]
      }
      const parent = routeManifest[route.parent]
      return [route, ...getAncestorRoutes(parent)]
    }

    try {
      const activeRoute = Object.values(routeManifest).find(
        (r) => r.path === req.path
      )

      if (!activeRoute) {
        res.status(404).send(`Not Found: ${req.url}`)
        return
      }

      const activeRoutes = getAncestorRoutes(activeRoute)

      const context = {
        url: req.url,
        actionData: null,
        loaderData: {},
      }

      if (!['GET', 'POST'].includes(req.method)) {
        res.status(405).send('Unsupported method')
        return
      }

      if (req.method === 'POST') {
        const action = activeRoutes.find((a) => a.action)?.action
        if (!action) {
          res.status(500).send('No action provided')
          return
        }

        try {
          const isSpaCall = req.query._action != null
          const actionResult = await action({ formData: req.body })
          if (actionResult instanceof Response) {
            sendFetchResponse(actionResult, res, isSpaCall)
            return
          }

          if (isSpaCall) {
            res.send(actionResult)
            return
          }

          context.actionData = actionResult
        } catch (e) {
          if (e instanceof Error) {
            throw e
          }

          if (e instanceof Response) {
            sendFetchResponse(e, res, req.query._action != null)
            return
          }

          throw new Error('Unsupported thrown value from action')
        }
      }

      const loaderRoutes = req.query._data
        ? req.query._data.split(',').map((id) => routeManifest[id])
        : activeRoutes

      const results = await Promise.all(
        loaderRoutes.map((a) =>
          a.loader ? a.loader({ request: req }) : Promise.resolve(null)
        )
      )
      results.forEach((data, i) =>
        Object.assign(context.loaderData, {
          [loaderRoutes[i].id]: data,
        })
      )

      if (req.query._data) {
        res.send(context.loaderData)
        return
      }

      const { app } = await serverCreateApp(context)

      const html = await renderApp(app, context)
      const hydrateObj = (v) =>
        `JSON.parse(${JSON.stringify(JSON.stringify(v))})`
      const page = `<!DOCTYPE html>
      <html>
         <head>
             <title>Vuemix</title>
             <link rel="stylesheet" href="/entry-client.css" />
         </head>
         <body>
             <div id="app">${html}</div>
             <script>
             window.__vuemix = {
              routeManifest: ${hydrateObj(clientRouteManifest)},
              actionData: ${hydrateObj(context.actionData)},
              loaderData: ${hydrateObj(context.loaderData)}
            };
             </script>
             <script src="/entry-client.js" type="module"></script>
             </body>
      </html>`
      res.setHeader('Content-Type', 'text/html')
      res.send(page)
    } catch (e) {
      next(e)
    }
  })

  server.listen(1234, () => {
    console.info('Server listening at http://localhost:8080')
  })
}

function sendFetchResponse(fetchResponse, expressResponse, isSpaCall = false) {
  const isRedirect = [301, 302, 307].includes(fetchResponse.status)
  const { headers } = fetchResponse
  if (isRedirect && isSpaCall) {
    expressResponse.status(200)
    expressResponse.set('x-vuemix-redirect', fetchResponse.status)
    expressResponse.set('x-vuemix-location', headers.get('location'))
    headers.delete('location')
  } else {
    expressResponse.status(fetchResponse.status)
  }
  headers.forEach((v, k) => expressResponse.set(k, v))
  expressResponse.send(fetchResponse.body)
}