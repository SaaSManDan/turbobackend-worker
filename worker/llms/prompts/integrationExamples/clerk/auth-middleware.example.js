import { verifyToken } from '@clerk/clerk-sdk-node';

export default defineEventHandler(async function(event) {
  // Skip auth for public routes
  if (event.path.startsWith('/api/public')) {
    return;
  }

  const authHeader = getHeader(event, 'Authorization');
  if (!authHeader) {
    throw createError({
      statusCode: 401,
      message: 'No authorization header'
    });
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const decoded = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY
    });

    // Attach user ID to request context
    event.context.userId = decoded.sub;
    event.context.user = decoded;
  } catch (error) {
    throw createError({
      statusCode: 401,
      message: 'Invalid or expired token'
    });
  }
});
