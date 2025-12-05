import { clerkClient } from '@clerk/clerk-sdk-node';

export default defineEventHandler(async function(event) {
  const userId = event.context.userId;

  if (!userId) {
    throw createError({ statusCode: 401, message: 'Unauthorized' });
  }

  try {
    const user = await clerkClient.users.getUser(userId);

    return {
      success: true,
      user: {
        id: user.id,
        email: user.emailAddresses[0]?.emailAddress,
        firstName: user.firstName,
        lastName: user.lastName
      }
    };
  } catch (error) {
    throw createError({
      statusCode: 500,
      message: 'Failed to get user info'
    });
  }
});
