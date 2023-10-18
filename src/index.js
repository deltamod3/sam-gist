const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { S3Client } = require( "@aws-sdk/client-s3");
const { DynamoDBDocumentClient } = require( "@aws-sdk/lib-dynamodb");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const dynamodbClient = new DynamoDBClient({});
const s3Client = new S3Client({});
const ddbDocClient = DynamoDBDocumentClient.from(dynamodbClient);

const PERMISSIONS_TABLE = "PrivateAlbumPermissions";
const VIDEOS1_TABLE = "Private1";
const VIDEOS2_TABLE = "Private2";
const BUCKET_NAME = "bucketdummy-dev";

async function generatePresignedUrl(videoKey) {
  const params = {
    Bucket: BUCKET_NAME,
    Key: videoKey,
    Expires: 3600, // 1 hour expiry
  };
  const url = await getSignedUrl(s3Client, params);
  return url;
}

async function getPresignedUrlsFromAlbum(albumTable, userIdGranting, prefix) {
  const params = {
    TableName: albumTable,
    FilterExpression: "userid = :userId",
    ExpressionAttributeValues: {
      ":userId": userIdGranting,
    },
  };

  const command = new ScanCommand(params);
  const response = await ddbDocClient.send(command);

  if (!response.Items || response.Items.length === 0) {
    return [];
  }

  const videos = response.Items[0];
  const urls = [];

  for (const [key, value] of Object.entries(videos)) {
    if (key.startsWith(prefix) && value) {
      urls.push(generatePresignedUrl(value));
    }
  }
  return urls;
}

async function checkPermissions(userIdGranting, userIdGranted) {
  const params = {
    TableName: PERMISSIONS_TABLE,
    FilterExpression:
      "userid_granting_permission = :granting AND userid_granted_permission = :granted",
    ExpressionAttributeValues: {
      ":granting": userIdGranting,
      ":granted": userIdGranted,
    },
  };

  const command = new ScanCommand(params);
  const response = await ddbDocClient.send(command);

  if (!response.Items || response.Items.length === 0) {
    return "locked";
  }

  const permissions = response.Items[0];
  return permissions;
}

exports.handler = async (event) => {
  const body = JSON.parse(event.body);
  const userIdGranted = body.userid_granted_permission;
  const userIdGranting = body.userid_granting_permission;

  const permissions = await checkPermissions(userIdGranting, userIdGranted);

  let album1Urls = [];
  let album2Urls = [];

  if (permissions.albumpermission1) {
    album1Urls = await getPresignedUrlsFromAlbum(
      VIDEOS1_TABLE,
      userIdGranting,
      "userprivatevideo1"
    );
  }

  if (permissions.albumpermission2) {
    album2Urls = await getPresignedUrlsFromAlbum(
      VIDEOS2_TABLE,
      userIdGranting,
      "userprivatevideo2"
    );
  }

  let response;
  if (!permissions.albumpermission1 && permissions.albumpermission2) {
    response = [...album2Urls, "locked"];
  } else if (permissions.albumpermission1 && !permissions.albumpermission2) {
    response = [...album1Urls, "locked"];
  } else if (permissions.albumpermission1 && permissions.albumpermission2) {
    response = [...album1Urls, ...album2Urls];
  } else {
    response = "locked";
  }

  return {
    statusCode: 200,
    body: JSON.stringify(response),
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  };
};
