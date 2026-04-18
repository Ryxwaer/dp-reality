export const config = {
  mongodbUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/dp-reality',
  grpcPort: process.env.GRPC_PORT ?? '50051',
  serviceName: process.env.SERVICE_NAME ?? 'module-sreality',
};
