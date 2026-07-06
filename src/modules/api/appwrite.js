// modules/appwrite.js
// IMPORTANT! THIS SCRIPT USES VERSION 24 OF APPWRITE, WHICH HAS MANY BREAKING CHANGES FROM EARLIER VERSIONS. DO NOT USE THE SYNTAX OR METHODS OF EARLIER VERSIONS WITHOUT CHECKING THEY ARE STILL VALID IN VERSION 24.
// React Native does not support importing from url, so this will have to be changed.
import { Client, Account, TablesDB, Storage, Permission, Role, ID, Query } from 'appwrite';

export const APPWRITE_CONFIG = {
    ENDPOINT: 'https://nyc.cloud.appwrite.io/v1',
    PROJECT_ID: '69e6faf4001ff72b2ac3',
    DATABASE_ID: '69e6fc160026cb28cf02',
    USER_PROFILES_TABLE_ID: 'userprofilestable', // Renamed for clarity
    AVATAR_BUCKET_ID: '69e6fc5200010a93b641'
};

const client = new Client()
    .setEndpoint(APPWRITE_CONFIG.ENDPOINT)
    .setProject(APPWRITE_CONFIG.PROJECT_ID);

export const account = new Account(client);
export const tablesDB = new TablesDB(client); // Exporting tablesDB for v24
export const storage = new Storage(client);
export { Permission, Role, ID, Query };

export async function getCurrentUser() {
    try {
        const user = await account.get();
        return user;
    } catch (error) {
        return null;
    }
}

export async function logout() {
    try {
        await account.deleteSession('current');
        return true;
    } catch (error) {
        console.error('Logout error:', error);
        return false;
    }
}
