const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sharedRoot = path.join(root, "shared");
const composePath = path.join(root, "docker-compose.micro.yml");
const compose = fs.readFileSync(composePath, "utf8");
const databases = {
  "telemetry-service": "fitness_telemetry",
  "goal-service": "fitness_goals",
  "notification-service": "fitness_notifications",
  "workout-service": "fitness_workouts",
};

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") return [];
      return listJavaScriptFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith(".js") ? [fullPath] : [];
  });
}

function serviceBlock(name) {
  const marker = new RegExp(`^  ${name}:\\s*$`, "m");
  const match = marker.exec(compose);
  if (!match) throw new Error(`Missing Compose service: ${name}`);
  const start = match.index;
  const rest = compose.slice(start + match[0].length);
  const nextService = /^\s{2}[a-z][a-z0-9-]*:\s*$/m.exec(rest);
  return compose.slice(start, nextService ? start + match[0].length + nextService.index : compose.length);
}

function assertDatabaseIsolation() {
  const names = Object.values(databases);
  if (new Set(names).size !== names.length) {
    throw new Error("Services must use four distinct MongoDB databases");
  }

  for (const [service, database] of Object.entries(databases)) {
    const block = serviceBlock(service);
    const uri = new RegExp(`^\\s+MONGO_URI:\\s*["']mongodb://mongo-micro:27017/${database}["']\\s*$`, "m");
    if (!uri.test(block)) throw new Error(`${service} must connect to ${database}`);
    if (/^\s+container_name:/m.test(block)) throw new Error(`${service} must not use a fixed container name`);
    if (/^\s+ports:/m.test(block)) throw new Error(`${service} must not publish an internal port`);

    const serviceRoot = path.join(root, service);
    for (const file of listJavaScriptFiles(serviceRoot)) {
      const source = fs.readFileSync(file, "utf8");
      const imports = source.matchAll(/require\((["'])(\.[^"']+)\1\)/g);
      for (const [, , request] of imports) {
        const target = path.resolve(path.dirname(file), request);
        const relativeToService = path.relative(serviceRoot, target);
        const relativeToShared = path.relative(sharedRoot, target);
        const leavesService = relativeToService === ".." || relativeToService.startsWith(`..${path.sep}`);
        const isShared = relativeToShared !== ".." && !relativeToShared.startsWith(`..${path.sep}`);
        if (leavesService && !isShared) {
          throw new Error(`${service} imports another service's files: ${path.relative(root, file)} -> ${request}`);
        }
      }
    }
  }
}

try {
  assertDatabaseIsolation();
  console.log("Database ownership checks passed: four isolated databases and no cross-service source imports.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
