import { exec } from "child_process";
import { PutObjectCommand, S3Client, S3ClientConfig } from "@aws-sdk/client-s3";
import { createReadStream, unlink, readFileSync } from "fs";
import { env } from "./env";
import crypto from 'crypto'

// @ts-ignore
function getMD5HashFromFile(file){
  var hash = crypto.createHash("md5")
      .update(file)
      .digest("base64");
  return hash;
}

const uploadToS3 = async (file: {name: string, path: string}): Promise<void> => {
  const bucket = env.AWS_S3_BUCKET;
  const clientOptions: S3ClientConfig = {
    region: env.AWS_S3_REGION,
  };

  console.log(`Uploading backup to S3 at ${bucket}/${file.name}...`);

  if (env.AWS_S3_ENDPOINT) {
    console.log(`Using custom endpoint: ${env.AWS_S3_ENDPOINT}`);

    clientOptions['endpoint'] = env.AWS_S3_ENDPOINT;
  }

  const client = new S3Client(clientOptions);

  const fileBuffer = readFileSync(file.path);
  const md5Hash = getMD5HashFromFile(fileBuffer);

  const readStream = createReadStream(file.path);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: file.name,
      Body: readStream,
      ContentMD5: md5Hash
    })
  )

  console.log("Backup uploaded.");
}

const dumpToFile = async (path: string): Promise<void> => {
  console.log(`Dumping database to file at ${path}...`);

  await new Promise((resolve, reject) => {
    exec(
      `mysqldump --host=${env.BACKUP_DATABASE_HOST} --port=${env.BACKUP_DATABASE_PORT} --user=${env.BACKUP_DATABASE_USER} --password=${env.BACKUP_DATABASE_PASSWORD} ${env.BACKUP_DATABASE_NAME} | gzip > ${path}`,
      (error, _, stderr) => {
        if (error) {
          reject({ error: JSON.stringify(error), stderr });
          return;
        }

        resolve(undefined);
      }
    );
  });

  console.log("Dump created.");
}

const deleteFile = async (path: string): Promise<void> => {
  console.log(`Deleting local dump file at ${path}...`);

  await new Promise((resolve, reject) => {
    unlink(path, (err) => {
      reject({ error: JSON.stringify(err) });
      return;
    });
    resolve(undefined);
  });

  console.log("Local dump file deleted.");
}

export const backup = async (): Promise<void> => {
  console.log(`Starting "${env.BACKUP_DATABASE_NAME}" database backup...`)

  const timestamp = new Date().toISOString().replace(/[:.]+/g, '-');
  const filename = `backup-${timestamp}.sql.gz`;
  const filepath = `/tmp/${filename}`;

  await dumpToFile(filepath);
  await uploadToS3({name: filename, path: filepath});
  await deleteFile(filepath);

  console.log("Database backup complete!")
}
