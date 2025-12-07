import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

const bucketName = process.env.AWS_S3_BUCKET_NAME;
const prefix = 'proj_abc123xyz/';

console.log(`📦 Checking S3 bucket: ${bucketName}`);
console.log(`📁 Prefix: ${prefix}\n`);

try {
    const command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        MaxKeys: 100
    });

    const response = await s3Client.send(command);

    if (!response.Contents || response.Contents.length === 0) {
        console.log('❌ No files found in S3!');
    } else {
        console.log(`✅ Found ${response.Contents.length} files in S3:\n`);

        // Show first 20 files
        response.Contents.slice(0, 20).forEach(function(obj) {
            console.log(`  ${obj.Key} (${obj.Size} bytes, modified: ${obj.LastModified})`);
        });

        if (response.Contents.length > 20) {
            console.log(`\n  ... and ${response.Contents.length - 20} more files`);
        }

        console.log(`\n📊 Total size: ${response.Contents.reduce((sum, obj) => sum + obj.Size, 0)} bytes`);
    }
} catch (error) {
    console.error('❌ Error listing S3 files:', error.message);
}
