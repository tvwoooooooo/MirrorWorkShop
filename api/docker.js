// api/docker.js
import { getDockerTags } from '../lib/docker.js';

export async function handleDockerTags(request, env) {
    const url = new URL(request.url);
    const imageName = url.searchParams.get('imageName');

    if (!imageName) {
        return new Response(JSON.stringify({ error: 'Missing imageName parameter' }), { status: 400 });
    }

    const tags = await getDockerTags(imageName, env);
    return new Response(JSON.stringify(tags), {
        headers: { 'Content-Type': 'application/json' },
    });
}
