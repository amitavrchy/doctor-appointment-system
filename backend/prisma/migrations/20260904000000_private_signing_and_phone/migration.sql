-- AlterTable
ALTER TABLE "Appointment" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "DoctorProfile" DROP COLUMN "signaturePinHash";

-- AlterTable
ALTER TABLE "FeatureFlag" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "OtpChallenge" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'LOGIN',
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "DoctorSigningCredential" (
    "doctorId" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoctorSigningCredential_pkey" PRIMARY KEY ("doctorId")
);

-- AddForeignKey
ALTER TABLE "DoctorSigningCredential" ADD CONSTRAINT "DoctorSigningCredential_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
