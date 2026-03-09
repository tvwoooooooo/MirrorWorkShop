// api/backup.js
import { startDockerBackupTask } from '../lib/docker.js';

export async function handleDockerBackup(request, env) {
    const body = await request.json();
    const { imageName, tag, bucketId } = body;

    if (!imageName || !tag || !bucketId) {
        return new Response(JSON.stringify({ error: 'Missing imageName, tag, or bucketId' }), { status: 400 });
    }

    const taskId = crypto.randomUUID();

    // This will now fetch the manifest and create all the necessary sub-tasks.
    // We don't await this, because it can take a while. The client will poll the task status.
    env.CTX.waitUntil(startDockerBackupTask(env, taskId, imageName, tag, bucketId));

    return new Response(JSON.stringify({ taskId }), { status: 202 });
}
