import { clerkClient } from '@clerk/clerk-sdk-node';

export default defineEventHandler(async function(event) {
  // User ID is available from auth middleware
  const userId = event.context.userId;

  if (!userId) {
    throw createError({
      statusCode: 401,
      message: 'Unauthorized - no user ID in context'
    });
  }

  try {
    // Fetch full user details from Clerk
    const user = await clerkClient.users.getUser(userId);

    return {
      success: true,
      user: {
        id: user.id,
        email: user.emailAddresses[0]?.emailAddress,
        firstName: user.firstName,
        lastName: user.lastName,
        createdAt: user.createdAt
      }
    };
  } catch (error) {
    throw createError({
      statusCode: 500,
      message: 'Failed to fetch user profile'
    });
  }
});
