import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import path from "path"

const PROTO_PATH = path.resolve("/proto/bot_module.proto")

let packageDef: protoLoader.PackageDefinition | null = null
let proto: any = null

function loadProto() {
  if (!packageDef) {
    packageDef = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: Number,
      defaults: true,
      oneofs: true,
    })
    proto = grpc.loadPackageDefinition(packageDef)
  }
  return proto
}

const clients = new Map<string, any>()

export function getModuleClient(address: string) {
  if (clients.has(address)) return clients.get(address)!

  const p = loadProto()
  const client = new p.botmodule.BotModule(
    address,
    grpc.credentials.createInsecure(),
  )
  clients.set(address, client)
  return client
}

export function callUnary<T>(client: any, method: string, request: any): Promise<T> {
  return new Promise((resolve, reject) => {
    client[method](request, (err: grpc.ServiceError | null, response: T) => {
      if (err) reject(err)
      else resolve(response)
    })
  })
}
