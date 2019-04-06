import { ByteString } from "node-opcua-basic-types";
import { makeNodeId, NodeId, resolveNodeId } from "node-opcua-nodeid";
import { CallMethodRequestLike, IBasicSession } from "node-opcua-pseudo-session";
import { StatusCode, StatusCodes } from "node-opcua-status-code";
import { DataType, VariantArrayType, VariantLike } from "node-opcua-variant";

const serverConfigurationNodeId = resolveNodeId("i=12637"/* Server_ServerConfiguration*/);
const createSigningRequestMethod = resolveNodeId("i=12737"/* Server_ServerConfiguration_CreateSigningRequest*/);
const getRejectedListMethod = resolveNodeId("i=12777"/* Server_ServerConfiguration_GetRejectedListRequest*/);
const updateCertificateMethod = resolveNodeId("i=13737"/* Server_ServerConfiguration_UpdateCertificate*/);

const certificateGroups = resolveNodeId("i=14053"/*Server_ServerConfiguration_CertificateGroups*/);
const defaultApplicationGroup = resolveNodeId("i=14156"/*Server_ServerConfiguration_CertificateGroups_DefaultApplicationGroup"*/);
const applyChangesMethod = resolveNodeId("i=12740" /* Server_ServerConfiguration_ApplyChanges*/);

export interface CreateSigningRequestResult {
    statusCode: StatusCode;
    certificateSigningRequest?: Buffer;
}

export interface GetRejectedListResult {
    statusCode: StatusCode;
    certificates?: Buffer[];
}

export interface UpdateCertificateResult {
    statusCode: StatusCode;
    applyChangeRequired?: boolean;
}

export class ClientPullCertificateManagement {

    public static rsaSha256ApplicationCertificateType: NodeId = resolveNodeId("i=12560");

    public session: IBasicSession;

    constructor(session: IBasicSession) {
        this.session = session;
    }

    /**
     * CreateSigningRequest Method asks the Server to create a PKCS #10 DER encoded
     * Certificate Request that is signed with the Server’s private key. This request can be then used
     * to request a Certificate from a CA that expects requests in this format.
     * This Method requires an encrypted channel and that the Client provide credentials with
     * administrative rights on the Server.
     *
     * @param certificateGroupId  - The NodeId of the Certificate Group Object which is affected by the request.
     *                              If null the DefaultApplicationGroup is used.
     * @param certificateTypeId   - The type of Certificate being requested. The set of permitted types is specified by
     *                              the CertificateTypes Property belonging to the Certificate Group.
     * @param subjectName         - The subject name to use in the Certificate Request.
     *                              If not specified the SubjectName from the current Certificate is used.
     *                              The subjectName parameter is a sequence of X.500 name value pairs separated by a ‘/’. For
     *                              example: CN=ApplicationName/OU=Group/O=Company.
     *                              If the certificateType is a subtype of ApplicationCertificateType the Certificate subject name
     *                              shall have an organization (O=) or domain name (DC=) field. The public key length shall meet
     *                              the length restrictions for the CertificateType. The domain name field specified in the subject
     *                              name is a logical domain used to qualify the subject name that may or may not be the same
     *                              as a domain or IP address in the subjectAltName field of the Certificate.
     *                              If the certificateType is a subtype of HttpsCertificateType the Certificate common name (CN=)
     *                              shall be the same as a domain from a DiscoveryUrl which uses HTTPS and the subject name
     *                              shall have an organization (O=) field.
     *                              If the subjectName is blank or null the CertificateManager generates a suitable default.
     * @param regeneratePrivateKey  If TRUE the Server shall create a new Private Key which it stores until the
     *                              matching signed Certificate is uploaded with the UpdateCertificate Method.
     *                              Previously created Private Keys may be discarded if UpdateCertificate was not
     *                              called before calling this method again. If FALSE the Server uses its existing
     *                              Private Key.
     * @param nonce                 Additional entropy which the caller shall provide if regeneratePrivateKey is TRUE.
     *                              It shall be at least 32 bytes long.
     *
     * @return                      The PKCS #10 DER encoded Certificate Request.
     *
     * Result Code                  Description
     * BadInvalidArgument          The certificateTypeId, certificateGroupId or subjectName is not valid.
     * BadUserAccessDenied          The current user does not have the rights required.
     */
    public async createSigningRequest(
      certificateGroupId: NodeId,
      certificateTypeId: NodeId,
      subjectName: string,
      regeneratePrivateKey?: boolean,
      nonce?: ByteString
    ): Promise<CreateSigningRequestResult> {

        const inputArguments = [
            { dataType: DataType.NodeId, value: certificateGroupId },
            { dataType: DataType.NodeId, value: certificateTypeId },
            { dataType: DataType.String, value: subjectName },
            { dataType: DataType.Boolean, value: !!regeneratePrivateKey },
            { dataType: nonce ? DataType.ByteString : DataType.Null, value: nonce }
        ];
        const methodToCall: CallMethodRequestLike = {
            inputArguments,
            methodId: createSigningRequestMethod,
            objectId: serverConfigurationNodeId
        };
        const callMethodResult = await this.session.call(methodToCall);

        if (callMethodResult.statusCode === StatusCodes.Good) {
            // xx console.log(callMethodResult.toString());
            return {
                certificateSigningRequest: callMethodResult.outputArguments![0].value,
                statusCode: callMethodResult.statusCode
            };
        } else {
            return { statusCode: callMethodResult.statusCode };
        }
    }

    /**
     * GetRejectedList Method returns the list of Certificates that have been rejected by the Server.
     * rules are defined for how the Server updates this list or how long a Certificate is kept in
     * the list. It is recommended that every valid but untrusted Certificate be added to the rejected
     * list as long as storage is available. Servers should omit older entries from the list returned if
     * the maximum message size is not large enough to allow the entire list to be returned.
     * This Method requires an encrypted channel and that the Client provides credentials with
     * administrative rights on the Server
     *
     * @return certificates The DER encoded form of the Certificates rejected by the Server
     */
    public async getRejectedList(): Promise<GetRejectedListResult> {
        const inputArguments: VariantLike[] = [];
        const methodToCall: CallMethodRequestLike = {
            inputArguments,
            methodId: getRejectedListMethod,
            objectId: serverConfigurationNodeId
        };
        const callMethodResult = await this.session.call(methodToCall);
        if (callMethodResult.statusCode === StatusCodes.Good) {
            if (callMethodResult.outputArguments![0].dataType !== DataType.ByteString) {
                return { statusCode: StatusCodes.BadInvalidArgument };
            }
            return {
                certificates: callMethodResult.outputArguments![0].value,
                statusCode: callMethodResult.statusCode
            };
        } else {
            return {
                statusCode: callMethodResult.statusCode
            };
        }
    }

    /**
     * UpdateCertificate is used to update a Certificate for a Server.
     * There are the following three use cases for this Method:
     *   • The new Certificate was created based on a signing request created with the Method
     *     CreateSigningRequest. In this case there is no privateKey provided.
     *   • A new privateKey and Certificate was created outside the Server and both are updated
     *     with this Method.
     *   • A new Certificate was created and signed with the information from the old Certificate.
     *    In this case there is no privateKey provided.
     *
     * The Server will do all normal integrity checks on the Certificate and all of the issuer
     * Certificates. If errors occur the Bad_SecurityChecksFailed error is returned.
     * The Server will report an error if the public key does not match the existing Certificate and
     * the privateKey was not provided.
     * If the Server returns applyChangesRequired=FALSE then it is indicating that it is able to
     * satisfy the requirements specified for the ApplyChanges Method.
     * This Method requires an encrypted channel and that the Client provides credentials with
     * administrative rights on the Server.
     *
     * @param certificateGroupId - The NodeId of the Certificate Group Object which is affected by the update.
     *                             If null the DefaultApplicationGroup is used.
     * @param certificateTypeId  - The type of Certificate being updated. The set of permitted types is specified by
     *                             the CertificateTypes Property belonging to the Certificate Group
     * @param certificate        - The DER encoded Certificate which replaces the existing Certificate.
     * @param issuerCertificates - The issuer Certificates needed to verify the signature on the new Certificate
     * @param privateKeyFormat   - The format of the Private Key (PEM or PFX). If the privateKey is not specified
     *                             the privateKeyFormat is null or empty
     * @param privateKey         - The Private Key encoded in the privateKeyFormat
     *
     * @return applyChangeRequired - Indicates that the ApplyChanges Method shall be called before the new
     *                               Certificate will be used.
     *
     *
     */
    public async updateCertificate(
      certificateGroupId: NodeId,
      certificateTypeId: NodeId,
      certificate: Buffer,
      issuerCertificates: Buffer[]
    ): Promise<UpdateCertificateResult>;
    public async updateCertificate(
      certificateGroupId: NodeId,
      certificateTypeId: NodeId,
      certificate: Buffer,
      issuerCertificates: Buffer[],
      privateKeyFormat: string,
      privateKey: Buffer
    ): Promise<UpdateCertificateResult>;
    public async updateCertificate(
      certificateGroupId: NodeId,
      certificateTypeId: NodeId,
      certificate: Buffer,
      issuerCertificates: Buffer[],
      privateKeyFormat?: string,
      privateKey?: Buffer
    ): Promise<UpdateCertificateResult> {

        const inputArguments: VariantLike[] = [
            { dataType: DataType.NodeId, value: certificateGroupId },
            { dataType: DataType.NodeId, value: certificateTypeId },
            { dataType: DataType.ByteString, value: certificate },
            { dataType: DataType.ByteString, arrayType: VariantArrayType.Array, value: issuerCertificates },
            privateKeyFormat
              ? { dataType: DataType.String, value: privateKeyFormat! }
              : { dataType: DataType.Null },
            privateKeyFormat
              ? { dataType: DataType.ByteString, value: privateKey }
              : { dataType: DataType.Null }
        ];
        const methodToCall: CallMethodRequestLike = {
            inputArguments,
            methodId: updateCertificateMethod,
            objectId: serverConfigurationNodeId
        };
        const callMethodResult = await this.session.call(methodToCall);
        if (callMethodResult.statusCode === StatusCodes.Good) {
            if (!callMethodResult.outputArguments || callMethodResult.outputArguments!.length !== 1) {
                return {
                    statusCode: StatusCodes.BadInternalError
                };
                // throw Error("Internal Error, expecting 1 output result");
            }
            return {
                applyChangeRequired: callMethodResult.outputArguments![0].value,
                statusCode: callMethodResult.statusCode
            };
        } else {
            return { statusCode: callMethodResult.statusCode };
        }
    }

    /**
     * ApplyChanges tells the Server to apply any security changes.
     * This Method should only be called if a previous call to a Method that changed the
     * configuration returns applyChangesRequired=true (see 7.7.4).
     * If the Server Certificate has changed, Secure Channels using the old Certificate will
     * eventually be interrupted. The only leeway the Server has is with the timing. In the best case,
     * the Server can close the TransportConnections for the affected Endpoints and leave any
     * Subscriptions intact. This should appear no different than a network interruption from the
     * perspective of the Client. The Client should be prepared to deal with Certificate changes
     * during its reconnect logic. In the worst case, a full shutdown which affects all connected
     * Clients will be necessary. In the latter case, the Server shall advertise its intent to interrupt
     * connections by setting the SecondsTillShutdown and ShutdownReason Properties in the
     * ServerStatus Variable.
     * If the Secure Channel being used to call this Method will be affected by the Certificate change
     * then the Server shall introduce a delay long enough to allow the caller to receive a reply.
     * This Method requires an encrypted channel and that the Client provide credentials with
     * administrative rights on the Server.
     *
     * Result Code            Description
     * Bad_UserAccessDenied   The current user does not have the rights required.
     */
    public async applyChanges(): Promise<StatusCode> {

        const methodToCall: CallMethodRequestLike = {
            inputArguments: [],
            methodId: applyChangesMethod,
            objectId: serverConfigurationNodeId
        };
        const callMethodResult = await this.session.call(methodToCall);

        if (callMethodResult.outputArguments && callMethodResult.outputArguments.length) {
            throw new Error("Invalid  output arguments");
        }
        return callMethodResult.statusCode;
    }

    public async getCertificateGroupId(certificateGroupName: string): Promise<NodeId> {

        if (certificateGroupName === "DefaultApplicationGroup") {
            return defaultApplicationGroup;
        }
        // toDO
        throw new Error("Not Implemented yet");
    }

}
