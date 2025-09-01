export const runtime = 'edge';

export default function handler(req: Request) {
  return new Response('pong', { status: 200 });
}
