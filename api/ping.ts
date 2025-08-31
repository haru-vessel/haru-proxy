export default async function handler(req: Request) {
  return new Response("pong", { status: 200 });
}
