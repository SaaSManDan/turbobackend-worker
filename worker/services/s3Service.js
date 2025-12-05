import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

// Initialize S3 client with credentials from environment variables
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

/**
 * Uploads a code file to S3 while preserving its directory structure
 * Includes metadata for Bedrock Knowledge Base filtering
 *
 * @param {string} projectId - The project ID
 * @param {string} filePath - The file path with subdirectories (e.g., "src/auth/login.js")
 * @param {string} fileContent - The raw file content
 * @param {object} metadata - Additional metadata for the file
 * @param {string} metadata.userId - The user ID
 * @param {string} metadata.language - The programming language
 * @returns {Promise<{s3Key: string, s3Bucket: string}>} - The S3 key and bucket name
 */
export async function uploadFileToS3(projectId, filePath, fileContent, metadata = {}) {
    try {
        // Construct S3 key: projectId/filePath to maintain directory structure
        // Example: "proj_123/src/auth/login.js"
        const s3Key = `${projectId}/${filePath}`;
        const s3Bucket = process.env.AWS_S3_BUCKET_NAME;

        // Create upload command with file content as buffer
        // Include metadata for Bedrock Knowledge Base filtering
        const uploadParams = {
            Bucket: s3Bucket,
            Key: s3Key,
            Body: Buffer.from(fileContent, 'utf-8'),
            ContentType: 'text/plain', // Set content type for code files
            Metadata: {
                projectid: projectId,
                userid: metadata.userId || '',
                language: metadata.language || '',
                filepath: filePath,
            },
        };

        // Use Upload for better handling of large files (automatic multipart upload)
        const upload = new Upload({
            client: s3Client,
            params: uploadParams,
        });

        // Execute the upload
        await upload.done();

        console.log(`File uploaded to S3: ${s3Key}`);

        // Upload companion .metadata.json file for Bedrock Knowledge Base filtering
        // This file must be stored alongside the source file with .metadata.json extension
        await uploadMetadataFile(s3Bucket, s3Key, projectId, metadata);

        return {
            s3Key,
            s3Bucket,
        };
    } catch (error) {
        console.error('Error uploading file to S3:', error);
        throw new Error(`S3 upload failed: ${error.message}`);
    }
}

/**
 * Uploads a .metadata.json file alongside a source file for Bedrock Knowledge Base
 * Bedrock requires this format for metadata filtering to work
 *
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} sourceS3Key - The S3 key of the source file
 * @param {string} projectId - The project ID
 * @param {object} metadata - Additional metadata
 * @returns {Promise<void>}
 */
async function uploadMetadataFile(s3Bucket, sourceS3Key, projectId, metadata) {
    try {
        // Create metadata JSON according to Bedrock spec
        const metadataContent = {
            metadataAttributes: {
                projectid: projectId,
                userid: metadata.userId || '',
                language: metadata.language || '',
                filepath: metadata.filePath || '',
            }
        };

        // Metadata file must have .metadata.json extension appended to source filename
        const metadataS3Key = `${sourceS3Key}.metadata.json`;

        const command = new PutObjectCommand({
            Bucket: s3Bucket,
            Key: metadataS3Key,
            Body: JSON.stringify(metadataContent),
            ContentType: 'application/json',
        });

        await s3Client.send(command);

        console.log(`Metadata file uploaded to S3: ${metadataS3Key}`);
    } catch (error) {
        console.error('Error uploading metadata file to S3:', error);
        throw new Error(`Metadata upload failed: ${error.message}`);
    }
}

/**
 * Downloads a file from S3
 *
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} s3Key - The S3 key
 * @returns {Promise<string>} - The file content as a string
 */
export async function downloadFileFromS3(s3Bucket, s3Key) {
    try {
        const command = new GetObjectCommand({
            Bucket: s3Bucket,
            Key: s3Key,
        });

        const response = await s3Client.send(command);

        // Convert stream to string
        const fileContent = await streamToString(response.Body);

        console.log(`File downloaded from S3: ${s3Key}`);

        return fileContent;
    } catch (error) {
        console.error('Error downloading file from S3:', error);
        throw new Error(`S3 download failed: ${error.message}`);
    }
}

/**
 * Deletes a file from S3 along with its companion .metadata.json file
 *
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} s3Key - The S3 key
 * @returns {Promise<void>}
 */
export async function deleteFileFromS3(s3Bucket, s3Key) {
    try {
        // Delete the source file
        const deleteCommand = new DeleteObjectCommand({
            Bucket: s3Bucket,
            Key: s3Key,
        });

        await s3Client.send(deleteCommand);

        console.log(`File deleted from S3: ${s3Key}`);

        // Delete the companion metadata file
        const metadataS3Key = `${s3Key}.metadata.json`;
        const deleteMetadataCommand = new DeleteObjectCommand({
            Bucket: s3Bucket,
            Key: metadataS3Key,
        });

        await s3Client.send(deleteMetadataCommand);

        console.log(`Metadata file deleted from S3: ${metadataS3Key}`);
    } catch (error) {
        console.error('Error deleting file from S3:', error);
        throw new Error(`S3 delete failed: ${error.message}`);
    }
}

/**
 * Helper function to convert a readable stream to string
 *
 * @param {ReadableStream} stream - The stream to convert
 * @returns {Promise<string>} - The stream content as string
 */
function streamToString(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
}
