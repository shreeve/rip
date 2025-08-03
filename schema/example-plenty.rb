create_table :account, primary_key: "AccountNum", id: :bigint do |t|
create_table :accountingautopay, primary_key: "AccountingAutoPayNum", id: :bigint do |t|
create_table :activeinstance, primary_key: "ActiveInstanceNum", id: :bigint do |t|
create_table :adjustment, primary_key: "AdjNum", id: :bigint do |t|
create_table :alertcategory, primary_key: "AlertCategoryNum", id: :bigint do |t|
create_table :alertcategorylink, primary_key: "AlertCategoryLinkNum", id: :bigint do |t|
create_table :alertitem, primary_key: "AlertItemNum", id: :bigint do |t|
create_table :alertread, primary_key: "AlertReadNum", id: :bigint do |t|
create_table :alertsub, primary_key: "AlertSubNum", id: :bigint do |t|
create_table :allergy, primary_key: "AllergyNum", id: :bigint do |t|
create_table :allergydef, primary_key: "AllergyDefNum", id: :bigint do |t|
create_table :anestheticdata, primary_key: "AnestheticDataNum" do |t|
create_table :anestheticrecord, primary_key: "AnestheticRecordNum" do |t|
create_table :anesthmedsgiven, primary_key: "AnestheticMedNum" do |t|
create_table :anesthmedsintake, primary_key: "AnestheticMedNum" do |t|
create_table :anesthmedsinventory, primary_key: "AnestheticMedNum" do |t|
create_table :anesthmedsinventoryadj, primary_key: "AdjustNum" do |t|
create_table :anesthmedsuppliers, primary_key: "SupplierIDNum" do |t|
create_table :anesthscore, primary_key: "AnesthScoreNum" do |t|
create_table :anesthvsdata, primary_key: "AnesthVSDataNum" do |t|
create_table :apikey, primary_key: "APIKeyNum", id: :bigint do |t|
create_table :apisubscription, primary_key: "ApiSubscriptionNum", id: :bigint do |t|
create_table :appointment, primary_key: "AptNum", id: :bigint do |t|
create_table :appointmentrule, primary_key: "AppointmentRuleNum", id: :bigint do |t|
create_table :appointmenttype, primary_key: "AppointmentTypeNum", id: :bigint do |t|
create_table :apptfield, primary_key: "ApptFieldNum", id: :bigint do |t|
create_table :apptfielddef, primary_key: "ApptFieldDefNum", id: :bigint do |t|
create_table :apptgeneralmessagesent, primary_key: "ApptGeneralMessageSentNum", id: :bigint do |t|
create_table :apptreminderrule, primary_key: "ApptReminderRuleNum", id: :bigint do |t|
create_table :apptremindersent, primary_key: "ApptReminderSentNum", id: :bigint do |t|
create_table :apptthankyousent, primary_key: "ApptThankYouSentNum", id: :bigint do |t|
create_table :apptview, primary_key: "ApptViewNum", id: :bigint do |t|
create_table :apptviewitem, primary_key: "ApptViewItemNum", id: :bigint do |t|
create_table :asapcomm, primary_key: "AsapCommNum", id: :bigint do |t|
create_table :autocode, primary_key: "AutoCodeNum", id: :bigint do |t|
create_table :autocodecond, primary_key: "AutoCodeCondNum", id: :bigint do |t|
create_table :autocodeitem, primary_key: "AutoCodeItemNum", id: :bigint do |t|
create_table :autocommexcludedate, primary_key: "AutoCommExcludeDateNum", id: :bigint do |t|
create_table :automation, primary_key: "AutomationNum", id: :bigint do |t|
create_table :automationcondition, primary_key: "AutomationConditionNum", id: :bigint do |t|
create_table :autonote, primary_key: "AutoNoteNum", id: :bigint do |t|
create_table :autonotecontrol, primary_key: "AutoNoteControlNum", id: :bigint do |t|
create_table :benefit, primary_key: "BenefitNum", id: :bigint do |t|
create_table :canadiannetwork, primary_key: "CanadianNetworkNum", id: :bigint do |t|
create_table :carecreditwebresponse, primary_key: "CareCreditWebResponseNum", id: :bigint do |t|
create_table :carrier, primary_key: "CarrierNum", id: :bigint do |t|
create_table :cdcrec, primary_key: "CdcrecNum", id: :bigint do |t|
create_table :cdspermission, primary_key: "CDSPermissionNum", id: :bigint do |t|
create_table :centralconnection, primary_key: "CentralConnectionNum", id: :bigint do |t|
create_table :cert, primary_key: "CertNum", id: :bigint do |t|
create_table :certemployee, primary_key: "CertEmployeeNum", id: :bigint do |t|
create_table :chartview, primary_key: "ChartViewNum", id: :bigint do |t|
create_table :claim, primary_key: "ClaimNum", id: :bigint do |t|
create_table :claimattach, primary_key: "ClaimAttachNum", id: :bigint do |t|
create_table :claimcondcodelog, primary_key: "ClaimCondCodeLogNum", id: :bigint do |t|
create_table :claimform, primary_key: "ClaimFormNum", id: :bigint do |t|
create_table :claimformitem, primary_key: "ClaimFormItemNum", id: :bigint do |t|
create_table :claimpayment, primary_key: "ClaimPaymentNum", id: :bigint do |t|
create_table :claimproc, primary_key: "ClaimProcNum", id: :bigint do |t|
create_table :claimsnapshot, primary_key: "ClaimSnapshotNum", id: :bigint do |t|
create_table :claimtracking, primary_key: "ClaimTrackingNum", id: :bigint do |t|
create_table :claimvalcodelog, primary_key: "ClaimValCodeLogNum", id: :bigint do |t|
create_table :clearinghouse, primary_key: "ClearinghouseNum", id: :bigint do |t|
create_table :clinic, primary_key: "ClinicNum", id: :bigint do |t|
create_table :clinicerx, primary_key: "ClinicErxNum", id: :bigint do |t|
create_table :clinicpref, primary_key: "ClinicPrefNum", id: :bigint do |t|
create_table :clockevent, primary_key: "ClockEventNum", id: :bigint do |t|
create_table :cloudaddress, primary_key: "CloudAddressNum", id: :bigint do |t|
create_table :codesystem, primary_key: "CodeSystemNum", id: :bigint do |t|
create_table :commlog, primary_key: "CommlogNum", id: :bigint do |t|
create_table :commoptout, primary_key: "CommOptOutNum", id: :bigint do |t|
create_table :computer, primary_key: "ComputerNum", id: :bigint do |t|
create_table :computerpref, primary_key: "ComputerPrefNum", id: :bigint do |t|
create_table :confirmationrequest, primary_key: "ConfirmationRequestNum", id: :bigint do |t|
create_table :connectiongroup, primary_key: "ConnectionGroupNum", id: :bigint do |t|
create_table :conngroupattach, primary_key: "ConnGroupAttachNum", id: :bigint do |t|
create_table :contact, primary_key: "ContactNum", id: :bigint do |t|
create_table :county, primary_key: "CountyNum", id: :bigint do |t|
create_table :covcat, primary_key: "CovCatNum", id: :bigint do |t|
create_table :covspan, primary_key: "CovSpanNum", id: :bigint do |t|
create_table :cpt, primary_key: "CptNum", id: :bigint do |t|
create_table :creditcard, primary_key: "CreditCardNum", id: :bigint do |t|
create_table :custrefentry, primary_key: "CustRefEntryNum", id: :bigint do |t|
create_table :custreference, primary_key: "CustReferenceNum", id: :bigint do |t|
create_table :cvx, primary_key: "CvxNum", id: :bigint do |t|
create_table :dashboardar, primary_key: "DashboardARNum", id: :bigint do |t|
create_table :dashboardcell, primary_key: "DashboardCellNum", id: :bigint do |t|
create_table :dashboardlayout, primary_key: "DashboardLayoutNum", id: :bigint do |t|
create_table :databasemaintenance, primary_key: "DatabaseMaintenanceNum", id: :bigint do |t|
create_table :dbmlog, primary_key: "DbmLogNum", id: :bigint do |t|
create_table :definition, primary_key: "DefNum", id: :bigint do |t|
create_table :deflink, primary_key: "DefLinkNum", id: :bigint do |t|
create_table :deletedobject, primary_key: "DeletedObjectNum", id: :bigint do |t|
create_table :deposit, primary_key: "DepositNum", id: :bigint do |t|
create_table :dictcustom, primary_key: "DictCustomNum", id: :bigint do |t|
create_table :discountplan, primary_key: "DiscountPlanNum", id: :bigint do |t|
create_table :discountplansub, primary_key: "DiscountSubNum", id: :bigint do |t|
create_table :disease, primary_key: "DiseaseNum", id: :bigint do |t|
create_table :diseasedef, primary_key: "DiseaseDefNum", id: :bigint do |t|
create_table :displayfield, primary_key: "DisplayFieldNum", id: :bigint do |t|
create_table :displayreport, primary_key: "DisplayReportNum", id: :bigint do |t|
create_table :dispsupply, primary_key: "DispSupplyNum", id: :bigint do |t|
create_table :document, primary_key: "DocNum", id: :bigint do |t|
create_table :documentmisc, primary_key: "DocMiscNum", id: :bigint do |t|
create_table :drugmanufacturer, primary_key: "DrugManufacturerNum", id: :bigint do |t|
create_table :drugunit, primary_key: "DrugUnitNum", id: :bigint do |t|
create_table :dunning, primary_key: "DunningNum", id: :bigint do |t|
create_table :ebill, primary_key: "EbillNum", id: :bigint do |t|
create_table :eclipboardimagecapture, primary_key: "EClipboardImageCaptureNum", id: :bigint do |t|
create_table :eclipboardimagecapturedef, primary_key: "EClipboardImageCaptureDefNum", id: :bigint do |t|
create_table :eclipboardsheetdef, primary_key: "EClipboardSheetDefNum", id: :bigint do |t|
create_table :eduresource, primary_key: "EduResourceNum", id: :bigint do |t|
create_table :ehramendment, primary_key: "EhrAmendmentNum", id: :bigint do |t|
create_table :ehraptobs, primary_key: "EhrAptObsNum", id: :bigint do |t|
create_table :ehrcareplan, primary_key: "EhrCarePlanNum", id: :bigint do |t|
create_table :ehrlab, primary_key: "EhrLabNum", id: :bigint do |t|
create_table :ehrlabclinicalinfo, primary_key: "EhrLabClinicalInfoNum", id: :bigint do |t|
create_table :ehrlabimage, primary_key: "EhrLabImageNum", id: :bigint do |t|
create_table :ehrlabnote, primary_key: "EhrLabNoteNum", id: :bigint do |t|
create_table :ehrlabresult, primary_key: "EhrLabResultNum", id: :bigint do |t|
create_table :ehrlabresultscopyto, primary_key: "EhrLabResultsCopyToNum", id: :bigint do |t|
create_table :ehrlabspecimen, primary_key: "EhrLabSpecimenNum", id: :bigint do |t|
create_table :ehrlabspecimencondition, primary_key: "EhrLabSpecimenConditionNum", id: :bigint do |t|
create_table :ehrlabspecimenrejectreason, primary_key: "EhrLabSpecimenRejectReasonNum", id: :bigint do |t|
create_table :ehrmeasure, primary_key: "EhrMeasureNum", id: :bigint do |t|
create_table :ehrmeasureevent, primary_key: "EhrMeasureEventNum", id: :bigint do |t|
create_table :ehrnotperformed, primary_key: "EhrNotPerformedNum", id: :bigint do |t|
create_table :ehrpatient, primary_key: "PatNum", id: :bigint, default: 0 do |t|
create_table :ehrprovkey, primary_key: "EhrProvKeyNum", id: :bigint do |t|
create_table :ehrquarterlykey, primary_key: "EhrQuarterlyKeyNum", id: :bigint do |t|
create_table :ehrsummaryccd, primary_key: "EhrSummaryCcdNum", id: :bigint do |t|
create_table :ehrtrigger, primary_key: "EhrTriggerNum", id: :bigint do |t|
create_table :electid, primary_key: "ElectIDNum", id: :bigint do |t|
create_table :emailaddress, primary_key: "EmailAddressNum", id: :bigint do |t|
create_table :emailattach, primary_key: "EmailAttachNum", id: :bigint do |t|
create_table :emailautograph, primary_key: "EmailAutographNum", id: :bigint do |t|
create_table :emailhostingtemplate, primary_key: "EmailHostingTemplateNum", id: :bigint do |t|
create_table :emailmessage, primary_key: "EmailMessageNum", id: :bigint do |t|
create_table :emailmessageuid, primary_key: "EmailMessageUidNum", id: :bigint do |t|
create_table :emailsecure, primary_key: "EmailSecureNum", id: :bigint do |t|
create_table :emailsecureattach, primary_key: "EmailSecureAttachNum", id: :bigint do |t|
create_table :emailtemplate, primary_key: "EmailTemplateNum", id: :bigint do |t|
create_table :employee, primary_key: "EmployeeNum", id: :bigint do |t|
create_table :employer, primary_key: "EmployerNum", id: :bigint do |t|
create_table :encounter, primary_key: "EncounterNum", id: :bigint do |t|
create_table :entrylog, primary_key: "EntryLogNum", id: :bigint do |t|
create_table :eobattach, primary_key: "EobAttachNum", id: :bigint do |t|
create_table :equipment, primary_key: "EquipmentNum", id: :bigint do |t|
create_table :erxlog, primary_key: "ErxLogNum", id: :bigint do |t|
create_table :eservicelog, primary_key: "EServiceLogNum", id: :bigint do |t|
create_table :eserviceshortguid, primary_key: "EServiceShortGuidNum", id: :bigint do |t|
create_table :eservicesignal, primary_key: "EServiceSignalNum", id: :bigint do |t|
create_table :etrans, primary_key: "EtransNum", id: :bigint do |t|
create_table :etrans835, primary_key: "Etrans835Num", id: :bigint do |t|
create_table :etrans835attach, primary_key: "Etrans835AttachNum", id: :bigint do |t|
create_table :etransmessagetext, primary_key: "EtransMessageTextNum", id: :bigint do |t|
create_table :evaluation, primary_key: "EvaluationNum", id: :bigint do |t|
create_table :evaluationcriterion, primary_key: "EvaluationCriterionNum", id: :bigint do |t|
create_table :evaluationcriteriondef, primary_key: "EvaluationCriterionDefNum", id: :bigint do |t|
create_table :evaluationdef, primary_key: "EvaluationDefNum", id: :bigint do |t|
create_table :famaging, primary_key: "PatNum", id: :bigint do |t|
create_table :familyhealth, primary_key: "FamilyHealthNum", id: :bigint do |t|
create_table :fee, primary_key: "FeeNum", id: :bigint do |t|
create_table :feesched, primary_key: "FeeSchedNum", id: :bigint do |t|
create_table :feeschedgroup, primary_key: "FeeSchedGroupNum", id: :bigint do |t|
create_table :fhircontactpoint, primary_key: "FHIRContactPointNum", id: :bigint do |t|
create_table :fhirsubscription, primary_key: "FHIRSubscriptionNum", id: :bigint do |t|
create_table :fielddeflink, primary_key: "FieldDefLinkNum", id: :bigint do |t|
create_table :files, primary_key: "DocNum", id: :bigint do |t|
create_table :formpat, primary_key: "FormPatNum", id: :bigint do |t|
create_table :gradingscale, primary_key: "GradingScaleNum", id: :bigint do |t|
create_table :gradingscaleitem, primary_key: "GradingScaleItemNum", id: :bigint do |t|
create_table :grouppermission, primary_key: "GroupPermNum", id: :bigint do |t|
create_table :guardian, primary_key: "GuardianNum", id: :bigint do |t|
create_table :hcpcs, primary_key: "HcpcsNum", id: :bigint do |t|
create_table :hieclinic, primary_key: "HieClinicNum", id: :bigint do |t|
create_table :hiequeue, primary_key: "HieQueueNum", id: :bigint do |t|
create_table :histappointment, primary_key: "HistApptNum", id: :bigint do |t|
create_table :hl7def, primary_key: "HL7DefNum", id: :bigint do |t|
create_table :hl7deffield, primary_key: "HL7DefFieldNum", id: :bigint do |t|
create_table :hl7defmessage, primary_key: "HL7DefMessageNum", id: :bigint do |t|
create_table :hl7defsegment, primary_key: "HL7DefSegmentNum", id: :bigint do |t|
create_table :hl7msg, primary_key: "HL7MsgNum", id: :bigint do |t|
create_table :hl7procattach, primary_key: "HL7ProcAttachNum", id: :bigint do |t|
create_table :icd10, primary_key: "Icd10Num", id: :bigint do |t|
create_table :icd9, primary_key: "ICD9Num", id: :bigint do |t|
create_table :imagedraw, primary_key: "ImageDrawNum", id: :bigint do |t|
create_table :imagingdevice, primary_key: "ImagingDeviceNum", id: :bigint do |t|
create_table :insbluebook, primary_key: "InsBlueBookNum", id: :bigint do |t|
create_table :insbluebooklog, primary_key: "InsBlueBookLogNum", id: :bigint do |t|
create_table :insbluebookrule, primary_key: "InsBlueBookRuleNum", id: :bigint do |t|
create_table :inseditlog, primary_key: "InsEditLogNum", id: :bigint do |t|
create_table :inseditpatlog, primary_key: "InsEditPatLogNum", id: :bigint do |t|
create_table :insfilingcode, primary_key: "InsFilingCodeNum", id: :bigint do |t|
create_table :insfilingcodesubtype, primary_key: "InsFilingCodeSubtypeNum", id: :bigint do |t|
create_table :insplan, primary_key: "PlanNum", id: :bigint do |t|
create_table :insplanpreference, primary_key: "InsPlanPrefNum", id: :bigint do |t|
create_table :inssub, primary_key: "InsSubNum", id: :bigint do |t|
create_table :installmentplan, primary_key: "InstallmentPlanNum", id: :bigint do |t|
create_table :instructor, primary_key: "InstructorNum" do |t|
create_table :insverify, primary_key: "InsVerifyNum", id: :bigint do |t|
create_table :insverifyhist, primary_key: "InsVerifyHistNum", id: :bigint do |t|
create_table :intervention, primary_key: "InterventionNum", id: :bigint do |t|
create_table :journalentry, primary_key: "JournalEntryNum", id: :bigint do |t|
create_table :labcase, primary_key: "LabCaseNum", id: :bigint do |t|
create_table :laboratory, primary_key: "LaboratoryNum", id: :bigint do |t|
create_table :labpanel, primary_key: "LabPanelNum", id: :bigint do |t|
create_table :labresult, primary_key: "LabResultNum", id: :bigint do |t|
create_table :labturnaround, primary_key: "LabTurnaroundNum", id: :bigint do |t|
create_table :language, primary_key: "LanguageNum", id: :bigint do |t|
create_table :languageforeign, primary_key: "LanguageForeignNum", id: :bigint do |t|
create_table :letter, primary_key: "LetterNum", id: :bigint do |t|
create_table :lettermerge, primary_key: "LetterMergeNum", id: :bigint do |t|
create_table :lettermergefield, primary_key: "FieldNum", id: :bigint do |t|
create_table :limitedbetafeature, primary_key: "LimitedBetaFeatureNum", id: :bigint do |t|
create_table :loginattempt, primary_key: "LoginAttemptNum", id: :bigint do |t|
create_table :loinc, primary_key: "LoincNum", id: :bigint do |t|
create_table :maparea, primary_key: "MapAreaNum", id: :bigint do |t|
create_table :medicalorder, primary_key: "MedicalOrderNum", id: :bigint do |t|
create_table :medication, primary_key: "MedicationNum", id: :bigint do |t|
create_table :medicationpat, primary_key: "MedicationPatNum", id: :bigint do |t|
create_table :medlab, primary_key: "MedLabNum", id: :bigint do |t|
create_table :medlabfacattach, primary_key: "MedLabFacAttachNum", id: :bigint do |t|
create_table :medlabfacility, primary_key: "MedLabFacilityNum", id: :bigint do |t|
create_table :medlabresult, primary_key: "MedLabResultNum", id: :bigint do |t|
create_table :medlabspecimen, primary_key: "MedLabSpecimenNum", id: :bigint do |t|
create_table :mobileappdevice, primary_key: "MobileAppDeviceNum", id: :bigint do |t|
create_table :mobiledatabyte, primary_key: "MobileDataByteNum", id: :bigint do |t|
create_table :mount, primary_key: "MountNum", id: :bigint do |t|
create_table :mountdef, primary_key: "MountDefNum", id: :bigint do |t|
create_table :mountitem, primary_key: "MountItemNum", id: :bigint do |t|
create_table :mountitemdef, primary_key: "MountItemDefNum", id: :bigint do |t|
create_table :oidexternal, primary_key: "OIDExternalNum", id: :bigint do |t|
create_table :oidinternal, primary_key: "OIDInternalNum", id: :bigint do |t|
create_table :operatory, primary_key: "OperatoryNum", id: :bigint do |t|
create_table :orionproc, primary_key: "OrionProcNum", id: :bigint do |t|
create_table :orthocase, primary_key: "OrthoCaseNum", id: :bigint do |t|
create_table :orthochart, primary_key: "OrthoChartNum", id: :bigint do |t|
create_table :orthochartrow, primary_key: "OrthoChartRowNum", id: :bigint do |t|
create_table :orthocharttab, primary_key: "OrthoChartTabNum", id: :bigint do |t|
create_table :orthocharttablink, primary_key: "OrthoChartTabLinkNum", id: :bigint do |t|
create_table :orthohardware, primary_key: "OrthoHardwareNum", id: :bigint do |t|
create_table :orthohardwarespec, primary_key: "OrthoHardwareSpecNum", id: :bigint do |t|
create_table :orthoplanlink, primary_key: "OrthoPlanLinkNum", id: :bigint do |t|
create_table :orthoproclink, primary_key: "OrthoProcLinkNum", id: :bigint do |t|
create_table :orthorx, primary_key: "OrthoRxNum", id: :bigint do |t|
create_table :orthoschedule, primary_key: "OrthoScheduleNum", id: :bigint do |t|
create_table :patfield, primary_key: "PatFieldNum", id: :bigint do |t|
create_table :patfielddef, primary_key: "PatFieldDefNum", id: :bigint do |t|
create_table :patient, primary_key: "PatNum", id: :bigint do |t|
create_table :patientlink, primary_key: "PatientLinkNum", id: :bigint do |t|
create_table :patientnote, primary_key: "PatNum", id: :bigint, default: 0 do |t|
create_table :patientportalinvite, primary_key: "PatientPortalInviteNum", id: :bigint do |t|
create_table :patientrace, primary_key: "PatientRaceNum", id: :bigint do |t|
create_table :patplan, primary_key: "PatPlanNum", id: :bigint do |t|
create_table :patrestriction, primary_key: "PatRestrictionNum", id: :bigint do |t|
create_table :payconnectresponseweb, primary_key: "PayConnectResponseWebNum", id: :bigint do |t|
create_table :payment, primary_key: "PayNum", id: :bigint do |t|
create_table :payortype, primary_key: "PayorTypeNum", id: :bigint do |t|
create_table :payperiod, primary_key: "PayPeriodNum", id: :bigint do |t|
create_table :payplan, primary_key: "PayPlanNum", id: :bigint do |t|
create_table :payplancharge, primary_key: "PayPlanChargeNum", id: :bigint do |t|
create_table :payplanlink, primary_key: "PayPlanLinkNum", id: :bigint do |t|
create_table :paysplit, primary_key: "SplitNum", id: :bigint do |t|
create_table :perioexam, primary_key: "PerioExamNum", id: :bigint do |t|
create_table :periomeasure, primary_key: "PerioMeasureNum", id: :bigint do |t|
create_table :pharmacy, primary_key: "PharmacyNum", id: :bigint do |t|
create_table :pharmclinic, primary_key: "PharmClinicNum", id: :bigint do |t|
create_table :phonenumber, primary_key: "PhoneNumberNum", id: :bigint do |t|
create_table :plannedappt, primary_key: "PlannedApptNum", id: :bigint do |t|
create_table :popup, primary_key: "PopupNum", id: :bigint do |t|
create_table :preference, primary_key: "PrefNum", id: :bigint do |t|
create_table :printer, primary_key: "PrinterNum", id: :bigint do |t|
create_table :procapptcolor, primary_key: "ProcApptColorNum", id: :bigint do |t|
create_table :procbutton, primary_key: "ProcButtonNum", id: :bigint do |t|
create_table :procbuttonitem, primary_key: "ProcButtonItemNum", id: :bigint do |t|
create_table :procbuttonquick, primary_key: "ProcButtonQuickNum", id: :bigint do |t|
create_table :proccodenote, primary_key: "ProcCodeNoteNum", id: :bigint do |t|
create_table :procedurecode, primary_key: "CodeNum", id: :bigint do |t|
create_table :procedurelog, primary_key: "ProcNum", id: :bigint do |t|
create_table :procgroupitem, primary_key: "ProcGroupItemNum", id: :bigint do |t|
create_table :procmultivisit, primary_key: "ProcMultiVisitNum", id: :bigint do |t|
create_table :procnote, primary_key: "ProcNoteNum", id: :bigint do |t|
create_table :proctp, primary_key: "ProcTPNum", id: :bigint do |t|
create_table :program, primary_key: "ProgramNum", id: :bigint do |t|
create_table :programproperty, primary_key: "ProgramPropertyNum", id: :bigint do |t|
create_table :promotion, primary_key: "PromotionNum", id: :bigint do |t|
create_table :promotionlog, primary_key: "PromotionLogNum", id: :bigint do |t|
create_table :provider, primary_key: "ProvNum", id: :bigint do |t|
create_table :providerclinic, primary_key: "ProviderClinicNum", id: :bigint do |t|
create_table :providercliniclink, primary_key: "ProviderClinicLinkNum", id: :bigint do |t|
create_table :providererx, primary_key: "ProviderErxNum", id: :bigint do |t|
create_table :providerident, primary_key: "ProviderIdentNum", id: :bigint do |t|
create_table :question, primary_key: "QuestionNum", id: :bigint do |t|
create_table :questiondef, primary_key: "QuestionDefNum", id: :bigint do |t|
create_table :quickpastecat, primary_key: "QuickPasteCatNum", id: :bigint do |t|
create_table :quickpastenote, primary_key: "QuickPasteNoteNum", id: :bigint do |t|
create_table :reactivation, primary_key: "ReactivationNum", id: :bigint do |t|
create_table :recall, primary_key: "RecallNum", id: :bigint do |t|
create_table :recalltrigger, primary_key: "RecallTriggerNum", id: :bigint do |t|
create_table :recalltype, primary_key: "RecallTypeNum", id: :bigint do |t|
create_table :reconcile, primary_key: "ReconcileNum", id: :bigint do |t|
create_table :recurringcharge, primary_key: "RecurringChargeNum", id: :bigint do |t|
create_table :refattach, primary_key: "RefAttachNum", id: :bigint do |t|
create_table :referral, primary_key: "ReferralNum", id: :bigint do |t|
create_table :referralcliniclink, primary_key: "ReferralClinicLinkNum", id: :bigint do |t|
create_table :registrationkey, primary_key: "RegistrationKeyNum", id: :bigint do |t|
create_table :reminderrule, primary_key: "ReminderRuleNum", id: :bigint do |t|
create_table :repeatcharge, primary_key: "RepeatChargeNum", id: :bigint do |t|
create_table :replicationserver, primary_key: "ReplicationServerNum", id: :bigint do |t|
create_table :reqneeded, primary_key: "ReqNeededNum", id: :bigint do |t|
create_table :reqstudent, primary_key: "ReqStudentNum", id: :bigint do |t|
create_table :requiredfield, primary_key: "RequiredFieldNum", id: :bigint do |t|
create_table :requiredfieldcondition, primary_key: "RequiredFieldConditionNum", id: :bigint do |t|
create_table :reseller, primary_key: "ResellerNum", id: :bigint do |t|
create_table :resellerservice, primary_key: "ResellerServiceNum", id: :bigint do |t|
create_table :rxalert, primary_key: "RxAlertNum", id: :bigint do |t|
create_table :rxdef, primary_key: "RxDefNum", id: :bigint do |t|
create_table :rxnorm, primary_key: "RxNormNum", id: :bigint do |t|
create_table :rxpat, primary_key: "RxNum", id: :bigint do |t|
create_table :schedule, primary_key: "ScheduleNum", id: :bigint do |t|
create_table :scheduledprocess, primary_key: "ScheduledProcessNum", id: :bigint do |t|
create_table :scheduleop, primary_key: "ScheduleOpNum", id: :bigint do |t|
create_table :schoolclass, primary_key: "SchoolClassNum", id: :bigint do |t|
create_table :schoolcourse, primary_key: "SchoolCourseNum", id: :bigint do |t|
create_table :screen, primary_key: "ScreenNum", id: :bigint do |t|
create_table :screengroup, primary_key: "ScreenGroupNum", id: :bigint do |t|
create_table :screenpat, primary_key: "ScreenPatNum", id: :bigint do |t|
create_table :securitylog, primary_key: "SecurityLogNum", id: :bigint do |t|
create_table :securityloghash, primary_key: "SecurityLogHashNum", id: :bigint do |t|
create_table :sessiontoken, primary_key: "SessionTokenNum", id: :bigint do |t|
create_table :sheet, primary_key: "SheetNum", id: :bigint do |t|
create_table :sheetdef, primary_key: "SheetDefNum", id: :bigint do |t|
create_table :sheetfield, primary_key: "SheetFieldNum", id: :bigint do |t|
create_table :sheetfielddef, primary_key: "SheetFieldDefNum", id: :bigint do |t|
create_table :sigbutdef, primary_key: "SigButDefNum", id: :bigint do |t|
create_table :sigelementdef, primary_key: "SigElementDefNum", id: :bigint do |t|
create_table :sigmessage, primary_key: "SigMessageNum", id: :bigint do |t|
create_table :signalod, primary_key: "SignalNum", id: :bigint do |t|
create_table :site, primary_key: "SiteNum", id: :bigint do |t|
create_table :smsblockphone, primary_key: "SmsBlockPhoneNum", id: :bigint do |t|
create_table :smsfrommobile, primary_key: "SmsFromMobileNum", id: :bigint do |t|
create_table :smsphone, primary_key: "SmsPhoneNum", id: :bigint do |t|
create_table :smstomobile, primary_key: "SmsToMobileNum", id: :bigint do |t|
create_table :snomed, primary_key: "SnomedNum", id: :bigint do |t|
create_table :sop, primary_key: "SopNum", id: :bigint do |t|
create_table :stateabbr, primary_key: "StateAbbrNum", id: :bigint do |t|
create_table :statement, primary_key: "StatementNum", id: :bigint do |t|
create_table :statementprod, primary_key: "StatementProdNum", id: :bigint do |t|
create_table :stmtlink, primary_key: "StmtLinkNum", id: :bigint do |t|
create_table :substitutionlink, primary_key: "SubstitutionLinkNum", id: :bigint do |t|
create_table :supplier, primary_key: "SupplierNum", id: :bigint do |t|
create_table :supply, primary_key: "SupplyNum", id: :bigint do |t|
create_table :supplyneeded, primary_key: "SupplyNeededNum", id: :bigint do |t|
create_table :supplyorder, primary_key: "SupplyOrderNum", id: :bigint do |t|
create_table :supplyorderitem, primary_key: "SupplyOrderItemNum", id: :bigint do |t|
create_table :task, primary_key: "TaskNum", id: :bigint do |t|
create_table :taskancestor, primary_key: "TaskAncestorNum", id: :bigint do |t|
create_table :taskattachment, primary_key: "TaskAttachmentNum", id: :bigint do |t|
create_table :taskhist, primary_key: "TaskHistNum", id: :bigint do |t|
create_table :tasklist, primary_key: "TaskListNum", id: :bigint do |t|
create_table :tasknote, primary_key: "TaskNoteNum", id: :bigint do |t|
create_table :tasksubscription, primary_key: "TaskSubscriptionNum", id: :bigint do |t|
create_table :taskunread, primary_key: "TaskUnreadNum", id: :bigint do |t|
create_table :tempdupnewpatnum, id: false do |t|
create_table :tempdupoldpatnum, id: false do |t|
create_table :tempinsbluebookrule_bak_20210422, id: false do |t|
create_table :tempmergeid, primary_key: "CurPatNum", id: :bigint, default: 0 do |t|
create_table :tempprogpropfix_bak, id: false do |t|
create_table :temprenumpatnum_bak, id: false do |t|
create_table :temprenumpatnum, id: false do |t|
create_table :tempuserod_bak, id: false do |t|
create_table :terminalactive, primary_key: "TerminalActiveNum", id: :bigint do |t|
create_table :timeadjust, primary_key: "TimeAdjustNum", id: :bigint do |t|
create_table :timecardrule, primary_key: "TimeCardRuleNum", id: :bigint do |t|
create_table :toolbutitem, primary_key: "ToolButItemNum", id: :bigint do |t|
create_table :toothgridcell, primary_key: "ToothGridCellNum", id: :bigint do |t|
create_table :toothgridcol, primary_key: "ToothGridColNum", id: :bigint do |t|
create_table :toothgriddef, primary_key: "ToothGridDefNum", id: :bigint do |t|
create_table :toothinitial, primary_key: "ToothInitialNum", id: :bigint do |t|
create_table :transaction, primary_key: "TransactionNum", id: :bigint do |t|
create_table :transactioninvoice, primary_key: "TransactionInvoiceNum", id: :bigint do |t|
create_table :treatplan, primary_key: "TreatPlanNum", id: :bigint do |t|
create_table :treatplanattach, primary_key: "TreatPlanAttachNum", id: :bigint do |t|
create_table :treatplanparam, primary_key: "TreatPlanParamNum", id: :bigint do |t|
create_table :tsitranslog, primary_key: "TsiTransLogNum", id: :bigint do |t|
create_table :ucum, primary_key: "UcumNum", id: :bigint do |t|
create_table :updatehistory, primary_key: "UpdateHistoryNum", id: :bigint do |t|
create_table :userclinic, primary_key: "UserClinicNum", id: :bigint do |t|
create_table :usergroup, primary_key: "UserGroupNum", id: :bigint do |t|
create_table :usergroupattach, primary_key: "UserGroupAttachNum", id: :bigint do |t|
create_table :userod, primary_key: "UserNum", id: :bigint do |t|
create_table :userodapptview, primary_key: "UserodApptViewNum", id: :bigint do |t|
create_table :userodpref, primary_key: "UserOdPrefNum", id: :bigint do |t|
create_table :userquery, primary_key: "QueryNum", id: :bigint do |t|
create_table :userweb, primary_key: "UserWebNum", id: :bigint do |t|
create_table :vaccinedef, primary_key: "VaccineDefNum", id: :bigint do |t|
create_table :vaccineobs, primary_key: "VaccineObsNum", id: :bigint do |t|
create_table :vaccinepat, primary_key: "VaccinePatNum", id: :bigint do |t|
create_table :vitalsign, primary_key: "VitalsignNum", id: :bigint do |t|
create_table :webschedcarrierrule, primary_key: "WebSchedCarrierRuleNum", id: :bigint do |t|
create_table :webschedrecall, primary_key: "WebSchedRecallNum", id: :bigint do |t|
create_table :wikilistheaderwidth, primary_key: "WikiListHeaderWidthNum", id: :bigint do |t|
create_table :wikilisthist, primary_key: "WikiListHistNum", id: :bigint do |t|
create_table :wikipage, primary_key: "WikiPageNum", id: :bigint do |t|
create_table :wikipagehist, primary_key: "WikiPageNum", id: :bigint do |t|
create_table :xchargetransaction, primary_key: "XChargeTransactionNum", id: :bigint do |t|
create_table :xwebresponse, primary_key: "XWebResponseNum", id: :bigint do |t|
create_table :zipcode, primary_key: "ZipCodeNum", id: :bigint do |t|
t.bigint :AccountNum!
t.bigint :AckEtransNum!
t.bigint :AdjNum!
t.bigint :AdjType!
t.bigint :AggTransLogNum!
t.bigint :AlertCategoryNum!
t.bigint :AlertItemNum!
t.bigint :AllergyDefNum!
t.bigint :AllowedFeeSched!
t.bigint :AnesthProvType!
t.bigint :AppointmentTypeNum!
t.bigint :ApptFieldDefNum!
t.bigint :ApptNum!
t.bigint :ApptReminderRuleNum!
t.bigint :ApptViewNum!
t.bigint :AptNum!
t.bigint :Assistant!
t.bigint :AutoCodeItemNum!
t.bigint :AutoCodeNum!
t.bigint :AutomationNum!
t.bigint :BillingType!
t.bigint :BillingTypeOne!
t.bigint :BillingTypeTwo!
t.bigint :BlockoutType!
t.bigint :CanadianNetworkNum!
t.bigint :CarrierGroupName!
t.bigint :CarrierNum!
t.bigint :CarrierNum2!
t.bigint :Category!
t.bigint :CentralConnectionNum!
t.bigint :CertCategoryNum!
t.bigint :CertNum!
t.bigint :ChartViewNum!
t.bigint :ClaimForm!
t.bigint :ClaimFormNum!
t.bigint :ClaimNum!
t.bigint :ClaimPaymentNum!
t.bigint :ClaimPaymentTracking!
t.bigint :ClaimProcNum!
t.bigint :ClearingHouseNum!
t.bigint :ClinicNum
t.bigint :ClinicNum!
t.bigint :CodeNum!
t.bigint :CommlogNum!
t.bigint :CommType!
t.bigint :ComputerNum!
t.bigint :Confirmed!
t.bigint :ConnectionGroupNum!
t.bigint :CopayFeeSched!
t.bigint :CovCatNum!
t.bigint :CreditCardNum!
t.bigint :CriterionFK!
t.bigint :CustomTracking!
t.bigint :DashboardLayoutNum!
t.bigint :DefaultCat!
t.bigint :DefaultProv!
t.bigint :DefNum!
t.bigint :DefNumError!
t.bigint :DepositAccountNum!
t.bigint :DepositNum!
t.bigint :DiscountPlanNum!
t.bigint :DiseaseDefNum!
t.bigint :DisplayFieldNum!
t.bigint :DocCategory!
t.bigint :DocNum!
t.bigint :DoNotSendWithin!
t.bigint :DrugManufacturerNum!
t.bigint :DrugUnitNum!
t.bigint :Dx!
t.bigint :EhrLabNum!
t.bigint :EhrLabResultNum!
t.bigint :EhrLabSpecimenNum!
t.bigint :EhrNotPerformedNum!
t.bigint :EmailAddressNum!
t.bigint :EmailAttachNum!
t.bigint :EmailChainFK!
t.bigint :EmailFK!
t.bigint :EmailHostingFK!
t.bigint :EmailHostingTemplateNum!
t.bigint :EmailMessageNum!
t.bigint :EmailSecureNum!
t.bigint :EmailTemplateNum!
t.bigint :EmployeeNum!
t.bigint :EmployerNum!
t.bigint :EtransMessageTextNum!
t.bigint :EtransNum!
t.bigint :EvaluationDefNum!
t.bigint :EvaluationNum!
t.bigint :ExternalID!
t.bigint :FeeSched!
t.bigint :FeeSchedNum!
t.bigint :FHIRSubscriptionNum!
t.bigint :FieldDefNum!
t.bigint :FilingCode!
t.bigint :FilingCodeSubtype!
t.bigint :FKey
t.bigint :FKey!
t.bigint :Fkey!
t.bigint :FormPatNum!
t.bigint :FromNum!
t.bigint :FSplitNum!
t.bigint :GenericNum!
t.bigint :GradingScaleNum!
t.bigint :GroupNum!
t.bigint :GroupProcMultiVisitNum!
t.bigint :GroupType!
t.bigint :Guarantor!
t.bigint :HistUserNum!
t.bigint :HL7DefMessageNum!
t.bigint :HL7DefNum!
t.bigint :HL7DefSegmentNum!
t.bigint :HL7MsgNum!
t.bigint :HqClearinghouseNum!
t.bigint :IDInternal!
t.bigint :ImageFolder!
t.bigint :InsBillingProv!
t.bigint :InsBlueBookRuleNum!, [0]
t.bigint :InsFilingCodeNum!
t.bigint :InsPlan1!
t.bigint :InsPlan2!
t.bigint :InsSubNum!
t.bigint :InsSubNum2!
t.bigint :InstructNum!
t.bigint :InstructorNum!
t.bigint :InsVerifyNum!
t.bigint :ItemOrder!
t.bigint :KeyNum!
t.bigint :LaboratoryNum!
t.bigint :LabPanelNum!
t.bigint :LabResultImageCat!
t.bigint :LateChargeAdjNum!
t.bigint :LetterMergeNum!
t.bigint :LimitedBetaFeatureTypeNum!
t.bigint :ManualFeeSchedNum! , [0]
t.bigint :MapAreaContainerNum!
t.bigint :MedicalOrderNum!
t.bigint :MedicationNum!
t.bigint :MedLabFacilityNum!
t.bigint :MedLabNum!
t.bigint :MedLabResultNum!
t.bigint :MessageFk!
t.bigint :MobileAppDeviceNum!
t.bigint :MountDefNum!
t.bigint :MountItemNum!
t.bigint :MountNum!
t.bigint :NewPatNum!, [0]
t.bigint :NextAptNum!
t.bigint :ObjectNum!
t.bigint :OldPatNum!, [0]
t.bigint :Op!
t.bigint :OperatoryNum!
t.bigint :OpNum!
t.bigint :OrderingReferralNum!
t.bigint :OriginalPatNum, [0]
t.bigint :OrthoAutoProcCodeNumOverride!
t.bigint :OrthoCaseNum!
t.bigint :OrthoChartRowNum!
t.bigint :OrthoChartTabNum!
t.bigint :OrthoHardwareSpecNum!
t.bigint :OrthoType!
t.bigint :Parent!
t.bigint :ParentKey!
t.bigint :PatFieldDefNum!
t.bigint :PatNum!
t.bigint :PatNumChild!
t.bigint :PatNumCloneFrom!
t.bigint :PatNumCust!
t.bigint :PatNumFrom!
t.bigint :PatNumGuardian!
t.bigint :PatNumRef!
t.bigint :PatNumSubj!
t.bigint :PatNumTo!
t.bigint :PatPlanNum!
t.bigint :PayGroup!
t.bigint :PaymentNum!
t.bigint :PaymentType!
t.bigint :PayNum!
t.bigint :PayPlanChargeNum!
t.bigint :PayPlanNum!
t.bigint :PayType!
t.bigint :PerioExamNum!
t.bigint :PharmacyNum!
t.bigint :PlanCategory!
t.bigint :PlannedAptNum!
t.bigint :PlanNum!
t.bigint :PlanNum2!
t.bigint :PopupNumArchive!
t.bigint :PrefillStatusOverride!
t.bigint :PregDiseaseNum!
t.bigint :Priority!
t.bigint :PriorityDefNum!
t.bigint :PriProv!
t.bigint :ProcButtonNum!
t.bigint :ProcCat!
t.bigint :ProcCodeNum!
t.bigint :ProcessId!
t.bigint :ProcNum!
t.bigint :ProcNumLab!
t.bigint :ProcNumOrig!
t.bigint :Prognosis!
t.bigint :ProgramNum!
t.bigint :ProgramPropertyNum!, [0]
t.bigint :PromotionNum!
t.bigint :ProvBill!
t.bigint :ProvDentist!
t.bigint :ProvHyg!
t.bigint :ProvHygienist!
t.bigint :ProvNum!
t.bigint :ProvNumAdminister!
t.bigint :ProvNumBillingOverride!
t.bigint :ProvNumCheckedOut!
t.bigint :ProvNumDefault!
t.bigint :ProvNumOrdering!
t.bigint :ProvNumWebMail!
t.bigint :ProvOrderOverride!
t.bigint :ProvTreat!
t.bigint :PtoDefNum! , [0]
t.bigint :QuickPasteCatNum!
t.bigint :RangeEnd!
t.bigint :RangeStart!
t.bigint :ReactivationStatus!
t.bigint :RecallNum!
t.bigint :RecallStatus!
t.bigint :RecallTypeNum!
t.bigint :ReconcileNum!
t.bigint :ReferralNum!
t.bigint :ReferringProv!
t.bigint :Region!
t.bigint :RegistrationKeyNum!
t.bigint :RepeatChargeNum!
t.bigint :ReportsTo!
t.bigint :ReqNeededNum!
t.bigint :RequiredFieldNum!
t.bigint :ResellerNum!
t.bigint :ResponsParty!
t.bigint :ResubmitInterval!
t.bigint :RxCui!
t.bigint :RxDefNum!
t.bigint :ScheduleNum!
t.bigint :SchoolClassNum!
t.bigint :SchoolCourseNum!
t.bigint :ScreenGroupNum!
t.bigint :ScreenPatNum!
t.bigint :SecProv!
t.bigint :SecurityLogNum!
t.bigint :SecUserNumEdit!
t.bigint :SecUserNumEntry!
t.bigint :SecuUserNumEntry! , [0]
t.bigint :SetIdOBR!
t.bigint :SetIdOBX!
t.bigint :SetIdSPM!
t.bigint :SheetDefNum!
t.bigint :SheetFieldDefNum!
t.bigint :SheetFieldNum!
t.bigint :SheetNum!
t.bigint :SigElementDefNumExtra!
t.bigint :SigElementDefNumMsg!
t.bigint :SigElementDefNumUser!
t.bigint :SiteNum!
t.bigint :Slip!
t.bigint :Specialty!
t.bigint :StatementNum!
t.bigint :StudentNum!
t.bigint :Subscriber!
t.bigint :SuperFamily!
t.bigint :SupplierNum!
t.bigint :SupplyNum!
t.bigint :SupplyOrderNum!
t.bigint :TaskListInBox!
t.bigint :TaskListNum!
t.bigint :TaskNum!
t.bigint :TaxTransID!
t.bigint :TemplateId!
t.bigint :TimeOfDayExportCCD!
t.bigint :TimeSpanMultipleInvites!
t.bigint :ToothGridColNum!
t.bigint :TQ1SetId!
t.bigint :TrackingDefNum!
t.bigint :TrackingErrorDefNum!
t.bigint :TransactionInvoiceNum!
t.bigint :TransactionNum!
t.bigint :TreatPlanNum!
t.bigint :TriageCategory!
t.bigint :TSPrior!
t.bigint :UnearnedType!
t.bigint :UnschedStatus!
t.bigint :UserGroupNum!
t.bigint :UserGroupNumCEMT!
t.bigint :UserNum!
t.bigint :UserNum! , [0]
t.bigint :UserNumCEMT!
t.bigint :UserNumHist!
t.bigint :UserNumLastConnect!
t.bigint :UserNumOrthoLocked!
t.bigint :UserNumPresenter!
t.bigint :VaccineDefNum!
t.bigint :VaccineObsNumGroup!
t.bigint :VaccinePatNum!
t.bigint :VerifyUserNum!
t.binary :Data! , size: :long
t.binary :Thumbnail, size: :long
t.boolean :CodeSubstNone!
t.boolean :DischAmb
t.boolean :DischAmbulance
t.boolean :DischCondStable
t.boolean :DischCondUnStable
t.boolean :DischWheelChr
t.boolean :GraphicsSimple!
t.boolean :GraphicsUseHardware!
t.boolean :HgtUnitsCm
t.boolean :HgtUnitsIn
t.boolean :HidePayment!
t.boolean :Intermingled!
t.boolean :IsDisabled!
t.boolean :IsForeign!
t.boolean :IsHidden!
t.boolean :IsReadOnly!
t.boolean :IsSent!
t.boolean :MedRouteIM
t.boolean :MedRouteIVButtFly
t.boolean :MedRouteIVCath
t.boolean :MedRouteNasal
t.boolean :MedRoutePO
t.boolean :MedRouteRectal
t.boolean :MonBP
t.boolean :MonEKG
t.boolean :MonEtCO2
t.boolean :MonPrecordial
t.boolean :MonSpO2
t.boolean :MonTemp
t.boolean :PreExisting!
t.boolean :RteETT
t.boolean :RteNasCan
t.boolean :RteNasHood
t.boolean :ShowBaseUnits!
t.boolean :SigIsTopaz!
t.boolean :SinglePatient!
t.boolean :TaskKeepListHidden!
t.boolean :TimeLocked!
t.boolean :WgtUnitsKgs
t.boolean :WgtUnitsLbs
t.date :AccidentDate! , ["0001-01-01"]
t.date :AccountExpirationDate!, ["0001-01-01"]
t.date :AdjDate! , ["0001-01-01"]
t.date :AdmitDate! , ["0001-01-01"]
t.date :BandingDate! , ["0001-01-01"]
t.date :BandingDateOverride!, ["0001-01-01"]
t.date :Birthdate!
t.date :Birthdate! , ["0001-01-01"]
t.date :CanadaEstTreatStartDate! , ["0001-01-01"]
t.date :CanadianDateInitialLower! , ["0001-01-01"]
t.date :CanadianDateInitialUpper! , ["0001-01-01"]
t.date :CCExpiration! , ["0001-01-01"]
t.date :ChargeDate! , ["0001-01-01"]
t.date :CheckDate! , ["0001-01-01"]
t.date :DateAdded!
t.date :DateAdverseReaction!, ["0001-01-01"]
t.date :DateAgreement! , ["0001-01-01"]
t.date :DateCalc!, ["0001-01-01"]
t.date :DateCheckedOut! , ["0001-01-01"]
t.date :DateComplete! , ["0001-01-01"]
t.date :DateCompleted! , ["0001-01-01"]
t.date :DateCompleted!, ["0001-01-01"]
t.date :DateCP! , ["0001-01-01"]
t.date :DateCreated!, ["0001-01-01"]
t.date :DateDeposit! , ["0001-01-01"]
t.date :DateDisabled!
t.date :DateDispensed!, ["0001-01-01"]
t.date :DateDisplayed! , ["0001-01-01"]
t.date :DateDue! , ["0001-01-01"]
t.date :DateDueCalc! , ["0001-01-01"]
t.date :DateEffective! , ["0001-01-01"]
t.date :DateEncounter!, ["0001-01-01"]
t.date :DateEnd! , ["0001-01-01"]
t.date :DateEnded!
t.date :DateEntry! , ["0001-01-01"]
t.date :DateEntryC! , ["0001-01-01"]
t.date :DateEval! , ["0001-01-01"]
t.date :DateExam! , ["0001-01-01"]
t.date :DateExpectedBack! , ["0001-01-01"]
t.date :DateExpire! , ["0001-01-01"]
t.date :DateFirstPayment!, ["0001-01-01"]
t.date :DateFirstVisit! , ["0001-01-01"]
t.date :DateIllnessInjuryPreg! , ["0001-01-01"]
t.date :DateInsFinalized! , ["0001-01-01"]
t.date :DateInterestStart! , ["0001-01-01"]
t.date :DateIssued! , ["0001-01-01"]
t.date :DateLastAssigned! , ["0001-01-01"]
t.date :DateLastVerified! , ["0001-01-01"]
t.date :DateMostRecent!, ["0001-01-01"]
t.date :DateObs! , ["0001-01-01"]
t.date :DateOriginalProsth! , ["0001-01-01"]
t.date :DateOrthoPlacementOverride!, ["0001-01-01"]
t.date :DateOther! , ["0001-01-01"]
t.date :DatePay! , ["0001-01-01"]
t.date :DatePaycheck!, ["0001-01-01"]
t.date :DatePayPlanStart! , ["0001-01-01"]
t.date :DatePlaced!
t.date :DatePlanned! , ["0001-01-01"]
t.date :DatePrevious! , ["0001-01-01"]
t.date :DateProcComplete! , ["0001-01-01"]
t.date :DatePurchased! , ["0001-01-01"]
t.date :DateRangeFrom!
t.date :DateRangeTo!
t.date :DateReceived! , ["0001-01-01"]
t.date :DateReconcile!, ["0001-01-01"]
t.date :DateResent! , ["0001-01-01"]
t.date :DateScheduleBy! , ["0001-01-01"]
t.date :DateScheduled! , ["0001-01-01"]
t.date :DateSent!
t.date :DateSent! , ["0001-01-01"]
t.date :DateSentOrig! , ["0001-01-01"]
t.date :DateService! , ["0001-01-01"]
t.date :DateSold! , ["0001-01-01"]
t.date :DateStart! , ["0001-01-01"]
t.date :DateStart!, ["0001-01-01"]
t.date :DateStarted!
t.date :DateStartTobacco! , ["0001-01-01"]
t.date :DateStop! , ["0001-01-01"]
t.date :DateStopClock! , ["0001-01-01"]
t.date :DateSummary! , ["0001-01-01"]
t.date :DateSuppReceived! , ["0001-01-01"]
t.date :DateTaken! , ["0001-01-01"]
t.date :DateTask! , ["0001-01-01"]
t.date :DateTerm! , ["0001-01-01"]
t.date :DateTimeCreated!, ["0001-01-01"]
t.date :DateTL! , ["0001-01-01"]
t.date :DateTP!
t.date :DateTP! , ["0001-01-01"]
t.date :DateViewing!, ["0001-01-01"]
t.date :DebondDate! , ["0001-01-01"]
t.date :DebondDateExpected!, ["0001-01-01"]
t.date :DebondDateOverride! , ["0001-01-01"]
t.date :DisableUntilDate! , ["0001-01-01"]
t.date :ExamDate!
t.date :NewerDate! , ["0001-01-01"]
t.date :OrthoAutoNextClaimDate! , ["0001-01-01"]
t.date :OrthoDate! , ["0001-01-01"]
t.date :PayConnectTokenExp!, ["0001-01-01"]
t.date :PayDate!
t.date :PayPlanDate!
t.date :PriorDate! , ["0001-01-01"]
t.date :ProcDate!
t.date :ProcDate! , ["0001-01-01"]
t.date :RecurringChargeDate!, ["0001-01-01"]
t.date :RefDate!
t.date :RxDate!
t.date :SchedDate!
t.date :SecDateEntry! , ["0001-01-01"]
t.date :SGDate!
t.datetime :AckDateTime! , ["0001-01-01 00:00:00"]
t.datetime :AnestheticDate!
t.datetime :ApptDateTime! , ["0001-01-01 00:00:00"]
t.datetime :ApptSecDateTEntry! , ["0001-01-01 00:00:00"]
t.datetime :AptDateTime! , ["0001-01-01 00:00:00"]
t.datetime :BirthDate , ["0001-01-01 00:00:00"]
t.datetime :CommDateTime!
t.datetime :DateCreated!
t.datetime :DateCreated! , ["0001-01-01 00:00:00"]
t.datetime :DateDue! , ["0001-01-01 00:00:00"]
t.datetime :DateEnd! , ["0001-01-01 00:00:00"]
t.datetime :DateExclude!, ["0001-01-01 00:00:00"]
t.datetime :DateLastRun!, ["0001-01-01 00:00:00"]
t.datetime :DateTAcceptDeny!, ["0001-01-01 00:00:00"]
t.datetime :DateTAppend! , ["0001-01-01 00:00:00"]
t.datetime :DateTBackupScheduled!, ["0001-01-01 00:00:00"]
t.datetime :DateTCreated!
t.datetime :DateTCreated! , ["0001-01-01 00:00:00"]
t.datetime :DateTEntry! , ["0001-01-01 00:00:00"]
t.datetime :DateTEvent! , ["0001-01-01 00:00:00"]
t.datetime :DateTFail! , ["0001-01-01 00:00:00"]
t.datetime :DateTFail!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeActive! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeArrived!
t.datetime :DateTimeArrived! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeAskedToArrive!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeCharge!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeChecked!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeCollected! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeCollected!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeCompleted!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeConfirmExpire! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeConfirmTransmit!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeCreated!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeDeceased! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeDisabled!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeDismissed!
t.datetime :DateTimeDismissed! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeDue! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeEmailSent! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeEnd
t.datetime :DateTimeEnd! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeEntered! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeEntry!
t.datetime :DateTimeEntry! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeEntry!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeExpiration!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeExpire! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeExpired! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeExpires!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeFinished!
t.datetime :DateTimeFinished! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeInactive!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeLastActive!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeLastConnect!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeLastError!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeLastLogin! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeLink!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeNote!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeObs! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeOrder! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeOrig! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeOriginal! , ["0001-01-01 00:00:00"]
t.datetime :DateTimePending! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeRecd! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeReceived! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeReported! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeRSVP! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeSaved! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeSaved!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeSeated!
t.datetime :DateTimeSeated! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeSendFailed! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeSent! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeService!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeSheet! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeSig! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeSmsScheduled!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeSmsSent! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeStart
t.datetime :DateTimeStart! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeStop! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeTerminated!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeTest!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeThankYouTransmit!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeTrans! , ["0001-01-01 00:00:00"]
t.datetime :DateTimeUpdated!, ["0001-01-01 00:00:00"]
t.datetime :DateTimeUploaded!, ["0001-01-01 12:00:00"]
t.datetime :DateTimeUpserted!, ["0001-01-01 00:00:00"]
t.datetime :DateTLastLogin! , ["0001-01-01 00:00:00"]
t.datetime :DateTMeasureEdit!, ["0001-01-01 00:00:00"]
t.datetime :DateTPracticeSigned! , ["0001-01-01 00:00:00"]
t.datetime :DateTPrevious!, ["0001-01-01 00:00:00"]
t.datetime :DateTRecorded! , ["0001-01-01 00:00:00"]
t.datetime :DateTRequest! , ["0001-01-01 00:00:00"]
t.datetime :DateTSheetEdited!, ["0001-01-01 00:00:00"]
t.datetime :DateTSigned! , ["0001-01-01 00:00:00"]
t.datetime :DateTStamp! , ["0001-01-01 00:00:00"]
t.datetime :DateTUpdate! , ["0001-01-01 00:00:00"]
t.datetime :EntryDateTime!, ["0001-01-01 00:00:00"]
t.datetime :Expiration! , ["0001-01-01 00:00:00"]
t.datetime :FormDateTime!, ["0001-01-01 00:00:00"]
t.datetime :HistDateTStamp! , ["0001-01-01 00:00:00"]
t.datetime :HpfExpiration! , ["0001-01-01 00:00:00"]
t.datetime :IntakeDate!
t.datetime :LastAttempt! , ["0001-01-01 00:00:00"]
t.datetime :LastCheckInActivity!, ["0001-01-01 00:00:00"]
t.datetime :LastHeartBeat!, ["0001-01-01 00:00:00"]
t.datetime :LastLogin! , ["0001-01-01 00:00:00"]
t.datetime :LastQueryTime! , ["0001-01-01 00:00:00"]
t.datetime :LastRanDateTime!, ["0001-01-01 00:00:00"]
t.datetime :LogDateTime!
t.datetime :LogDateTime! , ["0001-01-01 00:00:00"]
t.datetime :MessageDateTime! , ["0001-01-01 00:00:00"]
t.datetime :MsgDateTime!
t.datetime :SecDateEntry! , ["0001-01-01 00:00:00"]
t.datetime :SecDateTEntry! , ["0001-01-01 00:00:00"]
t.datetime :SecDateTEntry!, ["0001-01-01 00:00:00"]
t.datetime :SigDateTime! , ["0001-01-01 00:00:00"]
t.datetime :SigDateTime!, ["0001-01-01 00:00:00"]
t.datetime :SmsContractDate! , ["0001-01-01 00:00:00"]
t.datetime :TimeDisplayed1! , ["0001-01-01 00:00:00"]
t.datetime :TimeDisplayed2! , ["0001-01-01 00:00:00"]
t.datetime :TimeEntered1! , ["0001-01-01 00:00:00"]
t.datetime :TimeEntered2! , ["0001-01-01 00:00:00"]
t.datetime :TimeEntry! , ["0001-01-01 00:00:00"]
t.datetime :TimeStamp!
t.datetime :TimeToRun! , ["0001-01-01 00:00:00"]
t.datetime :TransactionDateTime!, ["0001-01-01 00:00:00"]
t.datetime :TransDateTime! , ["0001-01-01 00:00:00"]
t.float :AccountBalance!, 53
t.float :AdjAmt! , 53, [0.0]
t.float :AdministeredAmt!
t.float :AllowedFee! , 53
t.float :AllowedOverride! , 53
t.float :AllowedOverride!, 53
t.float :Amount! , 53
t.float :Amount! , 53, [0.0]
t.float :AmountOverride!, 53
t.float :AmountTotal! , 53
t.float :AnnualMax! , 53, [-1.0]
t.float :APR!
t.float :APR! , 53, [0.0]
t.float :Bal_0_30! , 53
t.float :Bal_0_30! , 53, [0.0]
t.float :Bal_31_60! , 53
t.float :Bal_31_60! , 53, [0.0]
t.float :Bal_61_90! , 53
t.float :Bal_61_90! , 53, [0.0]
t.float :BalOver90! , 53
t.float :BalOver90! , 53, [0.0]
t.float :BalTotal! , 53
t.float :BalTotal! , 53, [0.0]
t.float :BalTotal!, 53
t.float :BandingAmount! , 53
t.float :BaseEst! , 53, [0.0]
t.float :BatchAmount! , 53
t.float :BatchTotal! , 53
t.float :CanadaAnticipatedPayAmount! , 53
t.float :CanadaInitialPayment! , 53
t.float :CanadaTimeUnits! , 53
t.float :CatPercUCR! , 53
t.float :ChargeAmt! , 53
t.float :ChargeAmt! , 53, [0.0]
t.float :ChargeAmtAlt! , 53
t.float :CheckAmt! , 53, [0.0]
t.float :ClaimFee! , 53, [0.0]
t.float :CompletedAmt! , 53
t.float :CopayAmt! , 53, [-1.0]
t.float :CopayOverride! , 53, [-1.0]
t.float :CreditAmt! , 53, [0.0]
t.float :DaysOfSupply , 53
t.float :DebitAmt! , 53, [0.0]
t.float :DebondAmount! , 53
t.float :DedApplied! , 53, [0.0]
t.float :DedEst! , 53
t.float :DedEstOverride! , 53
t.float :DegreesRotated!
t.float :DisableUntilBalance!, 53
t.float :Discount! , 53
t.float :DiscountPlanAmt! , 53
t.float :DispDefaultQuant!
t.float :DispQuantity!
t.float :DownPayment! , 53
t.float :DrugQty!
t.float :EndingBal! , 53, [0.0]
t.float :EstBalance! , 53, [0.0]
t.float :FamBal! , 53
t.float :Fee! , 53
t.float :FeeAllowed! , 53
t.float :FeeAmt! , 53, [0.0]
t.float :FeeBilled! , 53, [0.0]
t.float :FeeInsPrimary! , 53
t.float :FeeInsSecondary! , 53
t.float :FeePat! , 53
t.float :FontSize!
t.float :FontSize! , [0.0], unsigned: true
t.float :FullTimeEquiv!
t.float :GradeNumber!
t.float :Height!
t.float :Height! , [0.0]
t.float :Height! , 53
t.float :HelpButtonXAdjustment! , 53
t.float :HourlyProdGoalAmt! , 53
t.float :HoursAvailableForVerification!, 53
t.float :InsEst! , 53
t.float :InsEst! , 53, [0.0]
t.float :InsEstTotal! , 53
t.float :InsEstTotalOverride! , 53
t.float :InsPaid! , 53
t.float :InsPayAmt! , 53
t.float :InsPayAmt! , 53, [0.0]
t.float :InsPayEst! , 53
t.float :InsPayEst! , 53, [0.0]
t.float :Interest! , 53, [0.0]
t.float :IVFVol
t.float :LabFee! , 53
t.float :LevelDesired!
t.float :LevelOnHand!
t.float :MarketValue! , 53
t.float :MaxPointsPoss!
t.float :MonetaryAmt! , 53, [0.0]
t.float :MonthlyPayment! , 53
t.float :Movement! , [0.0]
t.float :MsgChargeUSD!
t.float :MsgDiscountUSD!
t.float :ObservationValueNumber1! , 53
t.float :ObservationValueNumber2! , 53
t.float :ObservationValueNumeric! , 53
t.float :OrthoAutoFeeBilled! , 53
t.float :OrthoAutoFeeBilledOverride!, 53, [-1.0]
t.float :OverallGradeNumber!
t.float :PaidOtherIns! , 53, [-1.0]
t.float :PaidOtherInsOverride!, 53
t.float :PatAmt! , 53, [0.0]
t.float :PayAmt! , 53
t.float :PayAmt! , 53, [0.0]
t.float :PayPlanDue! , 53
t.float :PayPlanDue!, 53
t.float :Price! , 53
t.float :PriInsAmt! , 53, [0.0]
t.float :Principal! , 53, [0.0]
t.float :ProcFee! , 53, [0.0]
t.float :PurchaseCost! , 53
t.float :QtyAdj , 53
t.float :QtyGiven , 53
t.float :QtyOnHand , 53, [0.0]
t.float :QtyOnHandOld , 53
t.float :QtyWasted , 53
t.float :RepeatAmt! , 53
t.float :SecInsAmt! , 53, [0.0]
t.float :ShareOfCost! , 53
t.float :ShippingCharge!, 53
t.float :SmsMonthlyLimit! , 53
t.float :SplitAmt! , 53, [0.0]
t.float :StartingBal! , 53, [0.0]
t.float :TaxAmt! , 53
t.float :TotalDue! , 53
t.float :TransAmt! , 53
t.float :ValAmount! , 53
t.float :VisitAmount! , 53
t.float :Weight!
t.float :Width! , [0.0]
t.float :Width! , 53
t.float :Writeoff! , 53
t.float :WriteOff! , 53, [0.0]
t.float :WriteOffEst! , 53
t.float :WriteOffEstOverride! , 53
t.float :XPos! , [0.0]
t.float :XPos! , 53
t.float :YPos! , [0.0]
t.float :YPos! , 53
t.index :AccountNum, name: "indexAccountNum"
t.index :AckEtransNum, name: "AckEtransNum"
t.index :AdjNum, name: "AdjNum"
t.index :AggTransLogNum, name: "AggTransLogNum"
t.index :AlertCategoryNum, name: "AlertCategoryNum"
t.index :AlertItemNum, name: "AlertItemNum"
t.index :AllergyDefNum, name: "AllergyDefNum"
t.index :AllowedFeeSched, name: "AllowedFeeSched"
t.index :AnestheticMedNum, name: "AnestheticMedNum"
t.index :AnestheticRecordNum, name: "AnestheticRecordNum"
t.index :AppointmentTypeNum, name: "AppointmentTypeNum"
t.index :ApptDateTime, name: "ApptDateTime"
t.index :ApptNum, name: "ApptNum"
t.index :ApptNum, name: "AptNum"
t.index :ApptReminderRuleNum, name: "ApptReminderRuleNum"
t.index :ApptViewNum, name: "ApptViewNum"
t.index :AptDateTime, name: "indexAptDateTime"
t.index :AptNum, name: "AptNum"
t.index :AptNum, name: "indexAptNum"
t.index :Assistant, name: "Assistant"
t.index :AutomationNum, name: "AutomationNum"
t.index :BenefitType, name: "BenefitType"
t.index :BillingType, name: "BillingType"
t.index :BillingTypeOne, name: "BillingTypeOne"
t.index :BillingTypeTwo, name: "BillingTypeTwo"
t.index :BlockoutType, name: "BlockoutType"
t.index :CanadianNetworkNum, name: "CanadianNetworkNum"
t.index :CarrierGroupName, name: "CarrierGroupName"
t.index :CarrierNum, name: "CarrierNum"
t.index :CarrierNum2, name: "CarrierNum2"
t.index :Category, name: "Category"
t.index :CdcrecCode, name: "CdcrecCode"
t.index :CentralConnectionNum, name: "CentralConnectionNum"
t.index :CertNum, name: "CertNum"
t.index :ChartNumber, name: "ChartNumber"
t.index :ChartViewNum, name: "ChartViewNum"
t.index :CheckDate, name: "CheckDate"
t.index :ClaimNum, name: "ClaimNum"
t.index :ClaimNum, name: "indexClaimNum"
t.index :ClaimPaymentNum, name: "ClaimPaymentNum"
t.index :ClaimPaymentNum, name: "indexClaimPaymentNum"
t.index :ClaimPaymentTracking, name: "ClaimPaymentTracking"
t.index :ClaimProcNum, name: "ClaimProcNum"
t.index :ClearingHouseNum, name: "ClearingHouseNum"
t.index :ClinicNum, name: "ClinicNum"
t.index :CodeNum, name: "CodeNum"
t.index :CodeSystemName, name: "CodeSystemName"
t.index :CodeValue, name: "CodeValue"
t.index :CodeValueEvent, name: "CodeValueEvent"
t.index :CodeValueReason, name: "CodeValueReason"
t.index :CodeValueResult, name: "CodeValueResult"
t.index :CommDateTime, name: "CommDateTime"
t.index :CommlogNum, name: "CommlogNum"
t.index :CommType, name: "CommType"
t.index :ComputerNum, name: "ComputerNum"
t.index :Confirmed, name: "Confirmed"
t.index :ConnectionGroupNum, name: "ConnectionGroupNum"
t.index :CopayFeeSched, name: "CopayFeeSched"
t.index :CovCatNum, name: "CovCatNum"
t.index :CoverageLevel, name: "CoverageLevel"
t.index :CptCode, name: "CptCode"
t.index :CreditCardNum, name: "CreditCardNum"
t.index :CriterionFK, name: "CriterionFK"
t.index :CustomTracking, name: "CustomTracking"
t.index :CvxCode, name: "CvxCode"
t.index :DashboardLayoutNum, name: "DashboardLayoutNum"
t.index :DateComplete, name: "DateComplete"
t.index :DateCP, name: "DateCP"
t.index :DateLastAssigned, name: "DateLastAssigned"
t.index :DatePay, name: "DatePay"
t.index :DatePrevious, name: "DatePrevious"
t.index :DateScheduled, name: "DateScheduled"
t.index :DateSuppReceived, name: "DateSuppReceived"
t.index :DateTimeArrived, name: "DateTimeArrived"
t.index :DateTimeEntry, name: "DateTimeEntry"
t.index :DateTimeOriginal, name: "DateTimeOriginal"
t.index :DateTimeSent, name: "DateTimeReminderSent"
t.index :DateTimeUploaded, name: "DateTimeUploaded"
t.index :DateTStamp, name: "DateTStamp"
t.index :DateTUpdate, name: "DateTUpdate"
t.index :DefaultProv, name: "DefaultProv"
t.index :DefNum, name: "DefNum"
t.index :DefNumError, name: "DefNumError"
t.index :DepositAccountNum, name: "DepositAccountNum"
t.index :DepositNum, name: "DepositNum"
t.index :DiscountPlanNum, name: "DiscountPlanNum"
t.index :DiseaseDefNum, name: "DiseaseDefNum"
t.index :DisplayFieldNum, name: "DisplayFieldNum"
t.index :DocNum, name: "DocNum"
t.index :DrugManufacturerNum, name: "DrugManufacturerNum"
t.index :DrugUnitNum, name: "DrugUnitNum"
t.index :EhrLabNum, name: "EhrLabNum"
t.index :EhrLabResultNum, name: "EhrLabResultNum"
t.index :EhrLabSpecimenNum, name: "EhrLabSpecimenNum"
t.index :EhrNotPerformedNum, name: "EhrNotPerformedNum"
t.index :Email, name: "Email"
t.index :EmailAddressNum, name: "EmailAddressNum"
t.index :EmailAttachNum, name: "EmailAttachNum"
t.index :EmailChainFK, name: "EmailChainFK"
t.index :EmailFK, name: "EmailFK"
t.index :EmailHostingFK, name: "EmailHostingFK"
t.index :EmailHostingTemplateNum, name: "EmailHostingTemplateNum"
t.index :EmailMessageNum, name: "EmailMessageNum"
t.index :EmailSecureNum, name: "EmailSecureNum"
t.index :EmailSendStatus, name: "EmailSendStatus"
t.index :EmailTemplateNum, name: "EmailTemplateNum"
t.index :EmployeeNum, name: "EmployeeNum"
t.index :EmployeeNum, name: "indexEmployeeNum"
t.index :EntryDateTime, name: "EntryDateTime"
t.index :EtransMessageTextNum, name: "EtransMessageTextNum"
t.index :EtransNum, name: "EtransNum"
t.index :EvaluationDefNum, name: "EvaluationDefNum"
t.index :EvaluationNum, name: "EvaluationNum"
t.index :Expiration, name: "Expiration"
t.index :ExternalID, name: "ExternalID"
t.index :FeeSched, name: "FeeSched"
t.index :FeeSchedNum, name: "FeeSchedNum"
t.index :FHIRSubscriptionNum, name: "FHIRSubscriptionNum"
t.index :FieldDefNum, name: "FieldDefNum"
t.index :FieldType, name: "FieldType"
t.index :FilingCodeSubtype, name: "FilingCodeSubtype"
t.index :FKey, name: "FKey"
t.index :Fkey, name: "Fkey"
t.index :FName, name: "indexFName", 10
t.index :FSplitNum, name: "PrepaymentNum"
t.index :GradingScaleNum, name: "GradingScaleNum"
t.index :GroupNum, name: "GroupNum"
t.index :GroupProcMultiVisitNum, name: "GroupProcMultiVisitNum"
t.index :GroupType, name: "GroupType"
t.index :Guarantor, name: "Guarantor"
t.index :Guarantor, name: "indexGuarantor"
t.index :GuidMessage, name: "GuidMessage"
t.index :HcpcsCode, name: "HcpcsCode"
t.index :HistUserNum, name: "HistUserNum"
t.index :HL7DefMessageNum, name: "HL7DefMessageNum"
t.index :HL7DefNum, name: "HL7DefNum"
t.index :HL7DefSegmentNum, name: "HL7DefSegmentNum"
t.index :HL7MsgNum, name: "HL7MsgNum"
t.index :HL7Status, name: "HL7Status"
t.index :HmPhone, name: "HmPhone"
t.index :HqClearinghouseNum, name: "HqClearinghouseNum"
t.index :Icd10Code, name: "Icd10Code"
t.index :ICD9Code, name: "ICD9Code"
t.index :InsBillingProv, name: "InsBillingProv"
t.index :InsFilingCodeNum, name: "InsFilingCodeNum"
t.index :InsPlan1, name: "InsPlan1"
t.index :InsPlan2, name: "InsPlan2"
t.index :InsSubNum, name: "InsSubNum"
t.index :InsSubNum2, name: "InsSubNum2"
t.index :InstructNum, name: "InstructNum"
t.index :InsVerifyNum, name: "InsVerifyNum"
t.index :IsDisabled, name: "IsDisabled"
t.index :IsInProcess, name: "IsInProcess"
t.index :IsSent, name: "IsSent"
t.index :ItemOrder, name: "ItemOrder"
t.index :IType, name: "IType"
t.index :KeyNum, name: "KeyNum"
t.index :LabPanelNum, name: "LabPanelNum"
t.index :LabResultID, name: "LabResultID"
t.index :LabResultImageCat, name: "LabResultImageCat"
t.index :LateChargeAdjNum, name: "LateChargeAdjNum"
t.index :LimitedBetaFeatureTypeNum, name: "LimitedBetaFeatureTypeNum"
t.index :LName, name: "indexLName", 10
t.index :LogDateTime, name: "LogDateTime"
t.index :LoincCode, name: "LoincCode"
t.index :ManualFeeSchedNum, name: "ManualFeeSchedNum"
t.index :MapAreaContainerNum, name: "MapAreaContainerNum"
t.index :MedicalOrderNum, name: "MedicalOrderNum"
t.index :MedicationNum, name: "MedicationNum"
t.index :MedLabFacilityNum, name: "MedLabFacilityNum"
t.index :MedLabNum, name: "MedLabNum"
t.index :MedLabResultNum, name: "MedLabResultNum"
t.index :MessageFk, name: "EmailMessageNum"
t.index :MessageFk, name: "MessageFk"
t.index :MethodName, name: "MethodName"
t.index :MobileAppDeviceNum, name: "MobileAppDeviceNum"
t.index :MonetaryAmt, name: "MonetaryAmt"
t.index :MountItemNum, name: "MountItemNum"
t.index :MountNum, name: "MountNum"
t.index :MsgText, name: "MsgText", 100
t.index :NextAptNum, name: "indexNextAptNum"
t.index :NextAptNum, name: "NextAptNum"
t.index :OldCode, name: "indexADACode"
t.index :OldPatNum, name: "IDX_TEMPRENUM_OLDPATNUM"
t.index :Op, name: "Op"
t.index :OperatoryNum, name: "OperatoryNum"
t.index :OpNum, name: "OpNum"
t.index :OrderingReferralNum, name: "OrderingReferralNum"
t.index :OrthoAutoProcCodeNumOverride, name: "OrthoAutoProcCodeNumOverride"
t.index :OrthoCaseNum, name: "OrthoCaseNum"
t.index :OrthoChartRowNum, name: "OrthoChartRowNum"
t.index :OrthoChartTabNum, name: "OrthoChartTabNum"
t.index :OrthoHardwareSpecNum, name: "OrthoHardwareSpecNum"
t.index :OrthoType, name: "OrthoType"
t.index :Parent, name: "indexParent"
t.index :ParentKey, name: "ParentKey"
t.index :PatNum, name: "indexPatNum"
t.index :PatNum, name: "PatNum"
t.index :PatNumChild, name: "PatNumChild"
t.index :PatNumCloneFrom, name: "PatNumCloneFrom"
t.index :PatNumCust, name: "PatNumCust"
t.index :PatNumFrom, name: "PatNumFrom"
t.index :PatNumGuardian, name: "PatNumGuardian"
t.index :PatNumRef, name: "PatNumRef"
t.index :PatNumSubj, name: "PatNumSubj"
t.index :PatNumTo, name: "PatNumTo"
t.index :PatPlanNum, name: "indexPatPlanNum"
t.index :PatStatus, name: "PatStatus"
t.index :PayGroup, name: "PayGroup"
t.index :PaymentNum, name: "PaymentNum"
t.index :PaymentType, name: "PaymentType"
t.index :PayNum, name: "PayNum"
t.index :PayPlanChargeNum, name: "PayPlanChargeNum"
t.index :PayPlanNum, name: "indexPayPlanNum"
t.index :PayPlanNum, name: "PayPlanNum"
t.index :PayType, name: "PayType"
t.index :Percent, name: "Percent"
t.index :PerioExamNum, name: "PerioExamNum"
t.index :PermType, name: "PermType"
t.index :PharmacyNum, name: "PharmacyNum"
t.index :PhoneNumberDigits, name: "PhoneNumberDigits"
t.index :PhoneNumberVal, name: "PhoneNumberVal"
t.index :PlanCategory, name: "PlanCategory"
t.index :PlannedAptNum, name: "PlannedAptNum"
t.index :PlanNum, name: "indexPlanNum"
t.index :PlanNum, name: "PlanNum"
t.index :PollingSeconds, name: "PollingSeconds"
t.index :PopupNumArchive, name: "PopupNumArchive"
t.index :PrefillStatusOverride, name: "PrefillStatusOverride"
t.index :PrefName, name: "PrefName"
t.index :PregDiseaseNum, name: "PregDiseaseNum"
t.index :Priority, name: "Priority"
t.index :PriorityDefNum, name: "PriorityDefNum"
t.index :PriProv, name: "PriProv"
t.index :ProcCode, name: "ProcCode"
t.index :ProcCodeNum, name: "ProcCodeNum"
t.index :ProcessId, name: "ProcessId"
t.index :ProcNum, name: "indexProcNum"
t.index :ProcNum, name: "ProcNum"
t.index :ProcNumLab, name: "procedurelog_ProcNumLab"
t.index :ProcNumOrig, name: "ProcNumOrig"
t.index :ProdType, name: "ProdType"
t.index :Prognosis, name: "Prognosis"
t.index :ProgramNum, name: "ProgramNum"
t.index :PromotionNum, name: "PromotionNum"
t.index :ProvBill, name: "ProvBill"
t.index :ProvDentist, name: "ProvDentist"
t.index :ProvHyg, name: "indexProvHyg"
t.index :ProvHyg, name: "ProvHyg"
t.index :ProvHygienist, name: "ProvHygienist"
t.index :ProvNum, name: "indexProvNum"
t.index :ProvNum, name: "ProvNum"
t.index :ProvNumAdminister, name: "ProvNumAdminister"
t.index :ProvNumBillingOverride, name: "ProvNumBillingOverride"
t.index :ProvNumCheckedOut, name: "ProvNumCheckedOut"
t.index :ProvNumDefault, name: "ProvNumDefault"
t.index :ProvNumOrdering, name: "ProvNumOrdering"
t.index :ProvNumWebMail, name: "ProvNumWebMail"
t.index :ProvOrderOverride, name: "ProvOrderOverride"
t.index :ProvTreat, name: "ProvTreat"
t.index :PtoDefNum, name: "PtoDefNum"
t.index :Quantity, name: "Quantity"
t.index :QuantityQualifier, name: "QuantityQualifier"
t.index :RawBase64Code, name: "RawBase64Code", 16
t.index :ReactivationStatus, name: "ReactivationStatus"
t.index :RecallNum, name: "RecallNum"
t.index :RecallTypeNum, name: "RecallTypeNum"
t.index :ReferralNum, name: "ReferralNum"
t.index :Region, name: "Region"
t.index :RegistrationKeyNum, name: "RegistrationKeyNum"
t.index :RepeatChargeNum, name: "RepeatChargeNum"
t.index :ReqNeededNum, name: "ReqNeededNum"
t.index :RequiredFieldNum, name: "RequiredFieldNum"
t.index :ResellerNum, name: "ResellerNum"
t.index :ResponsParty, name: "ResponsParty"
t.index :ResubmitInterval, name: "ResubmitInterval"
t.index :RxCui, name: "RxCui"
t.index :SchedDate, name: "SchedDate"
t.index :ScheduleNum, name: "ScheduleNum"
t.index :SchoolCourseNum, name: "SchoolCourseNum"
t.index :ScreenGroupNum, name: "ScreenGroupNum"
t.index :ScreenPatNum, name: "ScreenPatNum"
t.index :SecDateEntry, name: "SecDateEntry"
t.index :SecDateTEdit, name: "SecDateTEdit"
t.index :SecDateTEntry, name: "SecDateTEntry"
t.index :SecProv, name: "SecProv"
t.index :SecurityLogNum, name: "SecurityLogNum"
t.index :SecUserNumEdit, name: "SecUserNumEdit"
t.index :SecUserNumEntry, name: "SecUserNumEntry"
t.index :SecuUserNumEntry, name: "SecuUserNumEntry"
t.index :SentOrReceived, name: "SentOrReceived"
t.index :SessionTokenHash, name: "SessionTokenHash", 20
t.index :SetIdOBR, name: "SetIdOBR"
t.index :SetIdOBX, name: "SetIdOBX"
t.index :SetIdSPM, name: "SetIdSPM"
t.index :SheetDefNum, name: "SheetDefNum"
t.index :SheetFieldDefNum, name: "SheetFieldDefNum"
t.index :SheetFieldNum, name: "SheetFieldNum"
t.index :SheetNum, name: "SheetNum"
t.index :ShortGUID, name: "ShortGUID"
t.index :ShortGuid, name: "ShortGuid"
t.index :SigDateTime, name: "indexSigDateTime"
t.index :SigElementDefNumExtra, name: "SigElementDefNumExtra"
t.index :SigElementDefNumMsg, name: "SigElementDefNumMsg"
t.index :SigElementDefNumUser, name: "SigElementDefNumUser"
t.index :SiteNum, name: "SiteNum"
t.index :SmsSendStatus, name: "SmsSendStatus"
t.index :SnomedCode, name: "SnomedCode"
t.index :SopCode, name: "SopCode"
t.index :StatementNum, name: "StatementNum"
t.index :Status, name: "Status"
t.index :StudentNum, name: "StudentNum"
t.index :Subscriber, name: "Subscriber"
t.index :SuperFamily, name: "SuperFamily"
t.index :SupplierNum, name: "SupplierNum"
t.index :SupplyNum, name: "SupplyNum"
t.index :SupplyOrderNum, name: "SupplyOrderNum"
t.index :TaskListNum, name: "indexTaskListNum"
t.index :TaskListNum, name: "TaskListNum"
t.index :TaskNum, name: "TaskNum"
t.index :TaskStatus, name: "TaskStatus"
t.index :TaxTransID, name: "TaxTransID"
t.index :TemplateId, name: "TemplateId"
t.index :TimeDisplayed1, name: "TimeDisplayed1"
t.index :TimeOfDayExportCCD, name: "TimeOfDayExportCCD"
t.index :TimePeriod, name: "TimePeriod"
t.index :ToothGridColNum, name: "ToothGridColNum"
t.index :TQ1SetId, name: "TQ1SetId"
t.index :TrackingDefNum, name: "TrackingDefNum"
t.index :TrackingErrorDefNum, name: "TrackingErrorDefNum"
t.index :TransactionDateTime, name: "TransactionDateTime"
t.index :TransactionInvoiceNum, name: "TransactionInvoiceNum"
t.index :TransactionNum, name: "indexTransactionNum"
t.index :TreatPlanNum, name: "indexTreatPlanNum"
t.index :TreatPlanNum, name: "TreatPlanNum"
t.index :TriageCategory, name: "TriageCategory"
t.index :TrojanID, name: "TrojanID"
t.index :TSPrior, name: "TSPrior"
t.index :UcumCode, name: "UcumCode"
t.index :UnschedStatus, name: "UnschedStatus"
t.index :UserGroupNum, name: "UserGroupNum"
t.index :UserGroupNumCEMT, name: "UserGroupNumCEMT"
t.index :UserName, name: "UserName", 10
t.index :UserNum, name: "UserNum"
t.index :UserNumLastConnect, name: "UserNumLastConnect"
t.index :UserNumPresenter, name: "UserNumPresenter"
t.index :VaccineDefNum, name: "VaccineDefNum"
t.index :VaccineObsNumGroup, name: "VaccineObsNumGroup"
t.index :VaccinePatNum, name: "VaccinePatNum"
t.index :VerifyType, name: "VerifyType"
t.index :VerifyUserNum, name: "VerifyUserNum"
t.index :WeightCode, name: "WeightCode"
t.index :WirelessPhone, name: "WirelessPhone"
t.index :WkPhone, name: "WkPhone"
t.index [:AdjDate, :PatNum], name: "AdjDatePN"
t.index [:AptNum, :CodeNum, :ProcStatus, :IsCpoe, :ProvNum], name: "RadiologyProcs"
t.index [:AptStatus, :AptDateTime, :ClinicNum], name: "StatusDate"
t.index [:Birthdate, :PatStatus], name: "BirthdateStatus"
t.index [:CarrierNum, :CarrierName], name: "CarrierNumName"
t.index [:CarrierNum, :PlanNum], name: "CarrierNumPlanNum"
t.index [:ClaimNum, :ClaimPaymentNum, :InsPayAmt, :DateCP, :IsTransfer], name: "indexOutClaimCovering"
t.index [:ClaimPaymentNum, :Status, :InsPayAmt], name: "indexCPNSIPA"
t.index [:ClinicNum, :DateTimeSent], name: "ClinicDTSent"
t.index [:ClinicNum, :LogDateTime], name: "ClinicDateTime"
t.index [:ClinicNum, :PatStatus], name: "ClinicPatStatus"
t.index [:ClinicNum, :SchedType], name: "ClinicNumSchedType"
t.index [:DateDue, :IsDisabled, :RecallTypeNum, :DateScheduled], name: "DateDisabledType"
t.index [:DateTStamp, :PatNum], name: "DateTStampPN"
t.index [:EmployeeNum, :SchedDate, :SchedType, :StopTime], name: "EmpDateTypeStopTime"
t.index [:Etype, :DateTimeTrans], name: "EtransTypeAndDate"
t.index [:FeeSched, :CodeNum, :ClinicNum, :ProvNum], name: "FeeSchedCodeClinicProv"
t.index [:FKey, :FKeyType], name: "FKeyAndType"
t.index [:FKey, :LogType], name: "FkLogType"
t.index [:IDType, :IDInternal], name: "IDType"
t.index [:InsSubNum, :ProcNum, :Status, :ProcDate, :PatNum, :InsPayAmt, :InsPayEst], name: "indexTxFinder"
t.index [:LName, :FName], name: "indexLFName"
t.index [:LogType, :FKey], name: "FKeyType"
t.index [:MsgDateTime, :SentOrReceived], name: "MsgBoxCompound"
t.index [:PatNum, :ClaimStatus, :ClaimType, :DateSent], name: "PatStatusTypeDate"
t.index [:PatNum, :CommDateTime, :CommType], name: "indexPNCDateCType"
t.index [:PatNum, :DocCategory], name: "PNDC"
t.index [:PatNum, :PatRestrictType], name: "PatNumRestrictType"
t.index [:PatNum, :PhoneNumberDigits], name: "PatPhoneDigits"
t.index [:PatNum, :ProcStatus, :ClinicNum], name: "indexPNPSCN"
t.index [:PatNum, :ProcStatus, :CodeNum, :ProcDate], name: "PatStatusCodeDate"
t.index [:PatNum, :ProcStatus, :ProcFee, :UnitQty, :BaseUnits, :ProcDate], name: "indexAgingCovering"
t.index [:PatNum, :RxType], name: "PatNumRxType"
t.index [:PlanNum, :ClaimStatus, :ClaimType, :PatNum, :ClaimNum, :DateService, :ProvTreat, :ClaimFee, :ClinicNum], name: "indexOutClaimCovering"
t.index [:ProcDate, :ClinicNum, :ProcStatus], name: "DateClinicStatus"
t.index [:ProcNum, :AdjAmt], name: "indexPNAmt"
t.index [:ProcNum, :PlanNum, :Status, :InsPayAmt, :InsPayEst, :WriteOff, :NoBillIns], name: "indexAcctCov"
t.index [:ProcNum, :SplitAmt], name: "indexPNAmt"
t.index [:ProvNum, :DateCP], name: "indexPNDCP"
t.index [:ProvNum, :ProcDate], name: "indexPNPD"
t.index [:rootExternal, :IDExternal], name: "rootExternal", 62
t.index [:SecDateTEdit, :PatNum], name: "SecDateTEditPN"
t.index [:SentOrReceived, :RecipientAddress, :FromAddress], name: "MsgHistoricAddresses", length: { RecipientAddress: 50, FromAddress: 50 }
t.index [:SheetNum, :FieldType], name: "SheetNumFieldType"
t.index [:SmsStatus, :IsHidden, :ClinicNum], name: "StatusHiddenClinic"
t.index [:Status, :PatNum, :DateCP, :PayPlanNum, :InsPayAmt, :WriteOff, :InsPayEst, :ProcDate, :ProcNum], name: "indexAgingCovering"
t.index [:StmtLinkType, :FKey], name: "FKeyAndType"
t.index [:SuperFamily, :Mode_, :DateSent], name: "SuperFamModeDateSent"
t.integer :AbnormalFlag!, 1
t.integer :AccountColor!, [0]
t.integer :AcctType! , 1, [0], unsigned: true
t.integer :ActionCode! , 1
t.integer :Actions! , 1
t.integer :ActionType! , 1
t.integer :AdjModeAfterSeries!, 1
t.integer :AdjustIsOverridden!, 1
t.integer :AdministrationNoteCode!, 1
t.integer :AdministrationRoute! , 1
t.integer :AdministrationSite! , 1
t.integer :Age! , 1, [0], unsigned: true
t.integer :AgeAccount! , 1, [0], unsigned: true
t.integer :AlertType! , 1
t.integer :AllergyCDS! , 1
t.integer :AnesthesiaScore , 2
t.integer :AnestheticMedNum!
t.integer :AnestheticRecordNum
t.integer :AnestheticRecordNum!
t.integer :AnesthMedNum!
t.integer :AnesthProvType! , [3]
t.integer :AppendToSpecial!, 1
t.integer :AppointmentTypeColor!
t.integer :ApptSource! , 1
t.integer :ApptTextBackColor!
t.integer :AptStatus! , 1
t.integer :AptStatus! , 1, [0], unsigned: true
t.integer :AreaAlsoToothRange!, 1
t.integer :AskToArriveEarly!
t.integer :AssignBen! , 1
t.integer :AttachedImages!
t.integer :AttachedModels!
t.integer :AuthenticationType!, 1
t.integer :AutoAction! , 1
t.integer :AutoCheckSaveImage!, 1, [1]
t.integer :AutoProcessed! , 1
t.integer :Autotrigger! , 1
t.integer :BaseUnits!
t.integer :BatchNum!
t.integer :BatchNumber!
t.integer :BenefitType! , 1, [0], unsigned: true
t.integer :BillingCycleDay! , [1]
t.integer :BMIPercentile!
t.integer :BPDias , 2
t.integer :BpDiastolic! , 2
t.integer :BPMAP , 2
t.integer :BPSys , 2
t.integer :BpSystolic! , 2
t.integer :ButtonIndex!
t.integer :ButtonIndex! , 2
t.integer :Bvalue! , 2
t.integer :BypassGlobalLock! , 1
t.integer :CanadaNumAnticipatedPayments! , 1, unsigned: true
t.integer :CanadaPaymentMode! , 1, unsigned: true
t.integer :CanadaTreatDuration! , 1, unsigned: true
t.integer :CanadianEligibilityCode! , 1
t.integer :CanadianEncryptionMethod! , 1
t.integer :CanadianIsRprHandler! , 1
t.integer :CanadianMandProsthMaterial! , 1
t.integer :CanadianMaxProsthMaterial! , 1
t.integer :CanadianReferralReason! , 1
t.integer :CanadianSupportedTypes!
t.integer :CanChargeWhenNoBal!, 1
t.integer :CanElectronicallySign! , 1
t.integer :CanRepeat! , 1
t.integer :Cardinality! , 1
t.integer :CariesExperience!, 1, [0], unsigned: true
t.integer :CarrierTransCounter!
t.integer :CarrierTransCounter2!
t.integer :Category! , [0]
t.integer :Category! , 1
t.integer :Category! , 1, [0], unsigned: true
t.integer :CCSource! , 1
t.integer :CellColumn!
t.integer :CellRow!
t.integer :CellType! , 1
t.integer :ChannelType! , 1
t.integer :ChargeFrequency! , 1
t.integer :ChargeStatus! , 1
t.integer :ChargeType! , 1
t.integer :ChildGotNutrition! , 1
t.integer :ChildGotPhysCouns! , 1
t.integer :ClaimsUseUCR! , 1, [0], unsigned: true
t.integer :ClinicIsRestricted! , 1
t.integer :ClockStatus! , 1, [0], unsigned: true
t.integer :ClpSegmentIndex!
t.integer :CobInsPaidBehaviorOverride!, 1
t.integer :CobRule! , 1
t.integer :CodeSet! , 1
t.integer :ColorBack!
t.integer :ColorDraw!
t.integer :ColorFore!
t.integer :ColorOverride!
t.integer :ColorText!
t.integer :ColorTextBack!
t.integer :ColumnWidth!
t.integer :ColumnWidth! , 2
t.integer :ColumnWidthOverride!
t.integer :ColWidth!
t.integer :CommBridge! , 1, [0], unsigned: true
t.integer :CommSource , 1
t.integer :CompareField! , 1
t.integer :Comparison! , 1
t.integer :CompletionStatus! , 1
t.integer :Cond! , 1, [0], unsigned: true
t.integer :ConditionRelationship!, 1
t.integer :ConnectionType! , 1
t.integer :Consent! , 1
t.integer :ContactSystem! , 1
t.integer :ContactUse! , 1
t.integer :CopyNoteToProc!, 1
t.integer :CorrectionType! , 1
t.integer :CoverageLevel!
t.integer :CovOrder!
t.integer :CreatesClaim! , 1
t.integer :CropH!
t.integer :CropW!
t.integer :CropX!
t.integer :CropY!
t.integer :DashboardColumns!
t.integer :DashboardRows!
t.integer :DashboardTabOrder!
t.integer :DateIllnessInjuryPregQualifier!, 2
t.integer :DateOtherQualifier! , 2
t.integer :DatesShowing! , 1
t.integer :DateType! , 1
t.integer :DateType! , 1, [0], unsigned: true
t.integer :DaysActual! , 2
t.integer :DaysInAdvance!
t.integer :DaysPublished!, 2
t.integer :DBvalue! , 2
t.integer :DefaultHidePopups! , 1
t.integer :DefaultInterval!
t.integer :DefaultPercent!, 2
t.integer :DefaultPlaceService! , 1, [0], unsigned: true
t.integer :DemographicCDS! , 1
t.integer :Denominator!, 2
t.integer :DentaideCardSequence! , 1, unsigned: true
t.integer :DevicePage! , 1
t.integer :DeviceType! , 1
t.integer :DiscountType! , 1, [0], unsigned: true
t.integer :DisplayPrompt!, 1, [0], unsigned: true
t.integer :DispUnitsCount!
t.integer :DLvalue! , 2
t.integer :DocMiscType!, 1
t.integer :DoNotContact! , 1
t.integer :DoNotResend! , 1
t.integer :DownloadInbox! , 1
t.integer :DPC! , 1
t.integer :DPCpost! , 1
t.integer :DrawType! , 1
t.integer :DrugUnit! , 1
t.integer :DynamicPayPlanTPOption!, 1
t.integer :EarlyChildCaries!, 1, [0], unsigned: true
t.integer :EbenefitCat! , 1, [0], unsigned: true
t.integer :EditBibliography!, 1
t.integer :Eformat! , 1, [0], unsigned: true
t.integer :EhrMuStage!
t.integer :ElementAlignment!, 1
t.integer :ElementColor! , [0]
t.integer :ElementOrder! , 1, [0], unsigned: true
t.integer :EmailSendStatus! , 1
t.integer :EmployRelated! , 1, [0], unsigned: true
t.integer :Enabled! , 1, [0], unsigned: true
t.integer :EnabledStatus! , 1
t.integer :EraAutomationOverride! , 1
t.integer :ErxType! , 1
t.integer :EServiceAction , 2
t.integer :EServiceType , 1
t.integer :EtCo2 , 2
t.integer :Etype! , 1, unsigned: true
t.integer :EventType! , 1
t.integer :ExamFreqLimit!
t.integer :ExcludeOtherCoverageOnPriClaims!, 1
t.integer :ExcludeProcSync! , 1
t.integer :ExclusionFeeRule! , 1
t.integer :ExistingSealants!, 1, [0], unsigned: true
t.integer :Extension!
t.integer :FailedAttempts! , 1, unsigned: true
t.integer :FeeSchedType!
t.integer :FieldDefType! , 1
t.integer :FieldLocation!, 1
t.integer :FieldType!
t.integer :FieldType!, 1
t.integer :FKeyType! , 1
t.integer :FkeyType! , 1
t.integer :FlipOnAcquire! , 1
t.integer :FluorideFreqLimit!
t.integer :FontIsBold! , 1
t.integer :FormToOpen! , 1
t.integer :FrequencyDays!
t.integer :FunctionStatus! , 1
t.integer :Gender! , 1, [0], unsigned: true
t.integer :GlobalTaskFilterType!, 1
t.integer :GradeLevel! , 1, [0]
t.integer :GradYear!
t.integer :GraphicColor!
t.integer :GraphicsDoubleBuffering!, 1
t.integer :GraphicsUseDirectX11! , 1, [0]
t.integer :GrowthBehavior!
t.integer :GTypeNum! , 2, [0], unsigned: true
t.integer :HasCaries! , 1, [0], unsigned: true
t.integer :HasClinicBreakdownReports!, 1
t.integer :HasEarlyAccess! , 1
t.integer :HasFollowupPlan! , 1
t.integer :HasLogged! , 1
t.integer :HasLongDCodes! , 1
t.integer :HasMobileLayout! , 1
t.integer :HasPpoSubstWriteoffs! , 1
t.integer :HasProcOnRx! , 1
t.integer :HasSignedTil! , 1
t.integer :HasSuperBilling! , 1
t.integer :HasWeekendRate3! , 1
t.integer :Height!
t.integer :HideFromVerifyList! , 1
t.integer :HideGraphics! , 1
t.integer :HideIn! , 1
t.integer :HistApptAction! , 1
t.integer :HL7Status!
t.integer :HR , 2
t.integer :HtmlType! , 1
t.integer :IcdVersion! , 1, unsigned: true
t.integer :IdentifyingCode! , 1
t.integer :IdentifyingCode!, 1
t.integer :ImgType! , 1, [0], unsigned: true
t.integer :Inactive! , 1, [0], unsigned: true
t.integer :InboxHidePopups! , 1
t.integer :InitialType! , 1, [0], unsigned: true
t.integer :InOrOut! , 1
t.integer :InsIsPending! , 1, [0], unsigned: true
t.integer :InsPlansZeroWriteOffsOnAnnualMaxOverride! , 1
t.integer :InsPlansZeroWriteOffsOnFreqOrAgingOverride!, 1
t.integer :IntTooth! , 2
t.integer :IsAccepted! , 1
t.integer :IsActive! , 1
t.integer :IsAllowed! , 1
t.integer :IsApproved! , 1
t.integer :IsApptBubblesDisabled!, 1
t.integer :IsArchived! , 1
t.integer :IsAttachmentSendAllowed!, 1
t.integer :IsAudit! , 1
t.integer :IsAuto! , 1
t.integer :IsAutoReplyEnabled! , 1
t.integer :IsBadRef! , 1
t.integer :IsBalValid! , 1
t.integer :IsBlueBookEnabled! , 1, [1]
t.integer :IsBYODDevice! , 1
t.integer :IsCanadianLab! , 1, unsigned: true
t.integer :IsCategoryName! , 1
t.integer :IsCcCompleted! , 1
t.integer :IsCDA! , 1, unsigned: true
t.integer :IsCDAnet! , 1
t.integer :IsClaimExportAllowed! , 1, [1]
t.integer :IsClosed! , 1
t.integer :IsCoinsuranceInverted! , 1
t.integer :IsConfirmDefault! , 1
t.integer :IsConfirmEnabled! , 1
t.integer :IsControlled! , 1
t.integer :IsCpoe! , 1
t.integer :IsCropOld! , 1, unsigned: true
t.integer :IsDateProsthEst! , 1
t.integer :IsDeleted! , 1
t.integer :IsDeleted! , 1, [0]
t.integer :IsDisabled! , 1, [0], unsigned: true
t.integer :IsDisabledByHq!, 1
t.integer :IsDiscontinued!, 1
t.integer :IsDiscount! , 1, [0], unsigned: true
t.integer :IsDoctor! , 1
t.integer :IsDraft! , 1
t.integer :IsDynamic! , 1
t.integer :IsEffectiveComm!, 1
t.integer :IsEnabled! , 1
t.integer :IsEnabled!, 1, [0], unsigned: true
t.integer :IsEpcs! , 1
t.integer :IsEraDownloadAllowed! , 1, [2]
t.integer :IsErxEnabled! , 1
t.integer :IsErxOld! , 1
t.integer :IsFlipped! , 1, [0], unsigned: true
t.integer :IsFreeVersion! , 1
t.integer :IsFrequent! , 1, [0], unsigned: true
t.integer :IsFurloughed! , 1
t.integer :IsGlobal! , 1
t.integer :IsGuardian! , 1
t.integer :IsHidden! , 1
t.integer :IsHidden! , 1, [0], unsigned: true
t.integer :IsHidden! , 1, unsigned: true
t.integer :IsHidden!, 1
t.integer :IsHiddenReport! , 1
t.integer :IsHighSecurity! , 1
t.integer :IsHighSecurity!, 1
t.integer :IsHighSignificance!, 1
t.integer :IsHQCategory!, 1
t.integer :IsHygiene! , 1
t.integer :IsHygiene! , 1, [0], unsigned: true
t.integer :IsIdentifyProofed! , 1
t.integer :IsIneligible! , 1
t.integer :IsInProcess! , 1
t.integer :IsInstructor! , 1
t.integer :IsInsVerifyExcluded! , 1
t.integer :IsInternal! , 1
t.integer :IsInUse! , 1
t.integer :IsInvoice! , 1
t.integer :IsInvoiceCopy! , 1
t.integer :IsLabel! , 1
t.integer :IsLandscape! , 1
t.integer :IsLocked! , 1
t.integer :IsLocked! , 1, [0], unsigned: true
t.integer :IsMasked! , 1
t.integer :IsMedicaid! , 1, [0], unsigned: true
t.integer :IsMedical! , 1, [0], unsigned: true
t.integer :IsMedicalOnly! , 1
t.integer :IsMobile! , 1
t.integer :IsMultiPage! , 1
t.integer :IsMultiVisit! , 1
t.integer :IsMultiVisit!, 1
t.integer :IsNewPatAppt! , 1
t.integer :IsNewPatApptExcluded!, 1
t.integer :IsNewPatient! , 1
t.integer :IsNewPatient! , 1, [0], unsigned: true
t.integer :IsNoteChange! , 1
t.integer :IsNotPerson! , 1
t.integer :IsObsolete! , 1, [0], unsigned: true
t.integer :IsOffset! , 1
t.integer :IsOld! , 1
t.integer :IsOnCall! , 1
t.integer :IsOnlyForTesting! , 1
t.integer :IsOptional! , 1
t.integer :IsOrtho! , 1, [0], unsigned: true
t.integer :IsOutsideLab! , 1
t.integer :IsOvertimeExempt!, 1
t.integer :IsPartial! , 1
t.integer :IsPasswordResetRequired! , 1
t.integer :IsPatDeclined!, 1
t.integer :IsPaymentOption! , 1
t.integer :IsPending! , 1, [0], unsigned: true
t.integer :IsPreferred! , 1
t.integer :IsPrincDiag! , 1, [0], unsigned: true
t.integer :IsProcApptEnforced! , 1
t.integer :IsProcessed! , 1
t.integer :IsProcRequired! , 1
t.integer :IsPromptSetup!, 1, [1]
t.integer :IsProsth! , 1, [0], unsigned: true
t.integer :IsQuadAsToothNum! , 1
t.integer :IsRadiology! , 1
t.integer :IsReceipt! , 1
t.integer :IsRecurringActive! , 1
t.integer :IsRecurringCC! , 1
t.integer :IsReleased , 1, [0]
t.integer :IsRepair! , 1
t.integer :IsRepeating! , 1
t.integer :IsRepeating! , 1, [0], unsigned: true
t.integer :IsRequired! , 1
t.integer :IsResellerCustomer! , 1
t.integer :IsScrollStartDynamic! , 1
t.integer :IsSecondary! , 1, [0], unsigned: true
t.integer :IsSelfPortrait! , 1
t.integer :IsSelfPortrait!, 1
t.integer :IsSendAll! , 1
t.integer :IsSendForMinorsBirthday! , 1
t.integer :IsSentToHq! , 1
t.integer :IsSentToQuickBooksOnline!, 1
t.integer :IsSignedUp! , 1
t.integer :IsSigProvRestricted! , 1
t.integer :IsSplit! , 1, [0], unsigned: true
t.integer :IsSuperFamily!, 1
t.integer :IsTaxed! , 1, [0], unsigned: true
t.integer :IsTimeSensitive! , 1
t.integer :IsTokenSaved! , 1
t.integer :IsTpCharting! , 1
t.integer :IsTransfer! , 1
t.integer :IsTransitionOfCare!, 1
t.integer :IsTrustedDirect!, 1
t.integer :IsUnpaidProtectedLeave!, 1, [0]
t.integer :IsVisibleInSubMenu!, 1
t.integer :IsWebForm! , 1
t.integer :IsWebSched! , 1
t.integer :IsWorkingHome! , 1
t.integer :IsWorkingHome!, 1
t.integer :ItemColor!
t.integer :ItemColor! , [-16777216]
t.integer :ItemColor!, [0]
t.integer :ItemOrder
t.integer :ItemOrder!
t.integer :ItemOrder! , 2
t.integer :ItemOrder! , 2, [0], unsigned: true
t.integer :ItemOrder! , 2, unsigned: true
t.integer :ItemOrder!, 2, [0], unsigned: true
t.integer :ItemType! , 1
t.integer :IType! , 1
t.integer :IVAtt , 2
t.integer :IVGauge , 2
t.integer :IVSideL , 2
t.integer :IVSideR , 2
t.integer :KeyType , 2
t.integer :LabTestCDS! , 1
t.integer :LastBatchNumber! , 2, [0], unsigned: true
t.integer :LayoutMode! , 1
t.integer :LessIntrusive!, 1, [0], unsigned: true
t.integer :LightColor!
t.integer :LightRow! , 1, unsigned: true
t.integer :LimitedExamFreqLimit!
t.integer :LimitType! , 1
t.integer :LimitValue!
t.integer :LineNumber! , 1, unsigned: true
t.integer :LinkType! , 1
t.integer :LinkType!, 1
t.integer :ListEhrLabResultsHandlingF! , 1
t.integer :ListEhrLabResultsHandlingN! , 1
t.integer :LoginType!, 1
t.integer :LogSource! , 1
t.integer :LogType! , 1
t.integer :Lvalue! , 2
t.integer :MatchCount!
t.integer :MaxAge! , [-1]
t.integer :MBvalue! , 2
t.integer :MeasureType!, 1
t.integer :MedicaidIDLength!
t.integer :MedicationCDS! , 1
t.integer :MedOrderType! , 1
t.integer :MedType! , 1
t.integer :MessageType! , 1
t.integer :MinAge! , [-1]
t.integer :MinorAge!
t.integer :MissingAllTeeth! , 1, [0], unsigned: true
t.integer :MLvalue! , 2
t.integer :MobileWebPinFailedAttempts!, 1, unsigned: true
t.integer :Mode_! , 1, [0], unsigned: true
t.integer :Mode_! , 1, unsigned: true
t.integer :ModemPort! , 1, [0], unsigned: true
t.integer :ModeTx! , 1
t.integer :MonthRenew! , 1
t.integer :MsgPart!
t.integer :MsgParts!
t.integer :MsgTotal!
t.integer :MsgType! , 1
t.integer :N2OLMin , 2
t.integer :NeedsSealants! , 1, [0], unsigned: true
t.integer :NewerDays!
t.integer :NoBillIns! , 1, [0], unsigned: true
t.integer :NoSendElect! , 1, [0], unsigned: true
t.integer :NoShowDecimal! , 1
t.integer :NoShowLanguage! , 1
t.integer :NotPerson! , 1, [0], unsigned: true
t.integer :NumberOfPayments!
t.integer :Numerator! , 2
t.integer :O2LMin , 2
t.integer :ObjectType!
t.integer :ObjectType! , 1
t.integer :ObjectType! , 1, [0], unsigned: true
t.integer :ObjectTypes! , 2
t.integer :OfficeSequenceNumber!
t.integer :OffsetX! , 2, [0]
t.integer :OffsetY! , 2, [0]
t.integer :OnlyScheduledProvs! , 1, unsigned: true
t.integer :Operator! , 1
t.integer :OptOutEmail!
t.integer :OptOutSms!
t.integer :OrderQty!
t.integer :Ordinal! , 1, [0], unsigned: true
t.integer :Ordinal! , unsigned: true
t.integer :OrdinalPos!
t.integer :OrionStatusFlags!
t.integer :OrthoAutoClaimDaysWait!
t.integer :OrthoAutoProcFreq! , 1
t.integer :OrthoHardwareType! , 1
t.integer :OrthoHardwareType!, 1
t.integer :OrthoInsPayConsolidate! , 1
t.integer :OrthoMonthsTreatOverride! , [-1]
t.integer :OrthoRemainM! , 1, [0], unsigned: true
t.integer :OrthoTotalM! , 1, unsigned: true
t.integer :OrthoType! , 1
t.integer :OutlineColor! , [0]
t.integer :PAFreqLimit!
t.integer :PageCount!
t.integer :PaintType! , 1, [0]
t.integer :PasswordIsStrong! , 1
t.integer :PatFasting! , 1
t.integer :PatHgt , 2
t.integer :PatNum
t.integer :PatNum!
t.integer :PatRelat! , 1, [0], unsigned: true
t.integer :PatRelat2! , 1, [0], unsigned: true
t.integer :PatRestrictType!, 1
t.integer :PatScreenPerm! , 1
t.integer :PatSelectSearchMode! , 1
t.integer :PatStatus! , 1
t.integer :PatStatus! , 1, [0], unsigned: true
t.integer :PatWgt , 2
t.integer :PaymentRow!
t.integer :PaymentSource! , 1
t.integer :PaymentStatus! , 1
t.integer :PayPlanDebitType!, 1
t.integer :PaySchedule! , 1
t.integer :Percent! , 1
t.integer :Percentage! , 1, [-1]
t.integer :PercentOverride! , 1, [-1]
t.integer :PerioFreqLimit!
t.integer :PermType! , 1, [0], unsigned: true
t.integer :PhoneExt!
t.integer :PhoneType! , 1
t.integer :PlaceService! , 1, [0], unsigned: true
t.integer :PlaceService!, 1
t.integer :PlannedIsDone! , 1, [0], unsigned: true
t.integer :PollingSeconds!
t.integer :PopupLevel! , 1
t.integer :Position! , 1, [0], unsigned: true
t.integer :PracticeAddress! , 1
t.integer :PreferConfirmMethod! , 1, unsigned: true
t.integer :PreferContactConfidential!, 1
t.integer :PreferContactMethod! , 1, unsigned: true
t.integer :PreferRecallMethod! , 1, unsigned: true
t.integer :PreferredPixelFormatNum , [0]
t.integer :PrefillStatus! , 1
t.integer :Premed! , 1, unsigned: true
t.integer :PrintImages!, 1, [0], unsigned: true
t.integer :PrintSit! , 1, [0], unsigned: true
t.integer :Priority! , 1
t.integer :ProblemCDS! , 1
t.integer :ProbStatus! , 1
t.integer :ProcessId!
t.integer :ProcessStatus! , 1
t.integer :ProcLinkType! , 1
t.integer :ProcStatus! , 1
t.integer :ProcStatus! , 1, [0], unsigned: true
t.integer :ProcStatus!, 1
t.integer :ProcStatuses! , 1
t.integer :ProdType! , 1
t.integer :PromotionStatus! , 1
t.integer :Pronoun! , 1
t.integer :ProphyFreqLimit!
t.integer :ProvColor! , [0]
t.integer :ProvNum! , 2
t.integer :ProvStatus! , 1
t.integer :Pulse!
t.integer :QActivity , 2
t.integer :QCirc , 2
t.integer :QColor , 2
t.integer :QConc , 2
t.integer :QResp , 2
t.integer :Qty!
t.integer :Quantity! , 1, [0], unsigned: true
t.integer :QuantityQualifier!, 1, [0], unsigned: true
t.integer :QuarterValue!
t.integer :QuestType! , 1, unsigned: true
t.integer :Race! , 1
t.integer :RaceOld! , 1
t.integer :Radiographs! , 1, [0], unsigned: true
t.integer :RankCommonOrders!
t.integer :RankCommonTests!
t.integer :ReasonCategory!
t.integer :ReasonCode!
t.integer :RecallInterval! , [0]
t.integer :ReceiptID!
t.integer :RecentApptView! , 1, unsigned: true
t.integer :RefreshRateSeconds!
t.integer :RefToStatus! , 1, unsigned: true
t.integer :RefType! , 1
t.integer :RefusalReason! , 1
t.integer :Relationship! , 1
t.integer :Relationship! , 1, [0], unsigned: true
t.integer :ReleaseInfo! , 1
t.integer :ReminderCount!
t.integer :ReminderCriterion!, 1
t.integer :ReminderFrequency!
t.integer :ReminderType! , 2
t.integer :RemitAddress! , 1
t.integer :RemoteRole! , 1
t.integer :RequirePasswordChange!, 1
t.integer :RequireUserNameChange!, 1
t.integer :ResponseCode!
t.integer :ResponseStatus! , 1
t.integer :RevID!
t.integer :RotateOnAcquire!
t.integer :RowsPerIncr! , 1, [1], unsigned: true
t.integer :RSVPStatus! , 1
t.integer :Rule! , 1
t.integer :RuleType! , 1
t.integer :RxType! , 1
t.integer :ScaleType! , 1
t.integer :ScanDocDuplex! , 1
t.integer :ScanDocGrayscale! , 1
t.integer :ScanDocQuality! , 1, unsigned: true
t.integer :ScanDocResolution!
t.integer :ScanDocSelectSource! , 1
t.integer :ScanDocShowOptions! , 1
t.integer :SchedDayOfWeek! , 1, unsigned: true
t.integer :SchedType! , 1, [0], unsigned: true
t.integer :ScreenGroupOrder!, 2, [0], unsigned: true
t.integer :SelectedTeethOnly!, 1
t.integer :SendMultipleInvites! , 1
t.integer :SendStatus! , 1
t.integer :SensorBinned! , 1
t.integer :SensorExposure , [1]
t.integer :SensorPort , [0]
t.integer :SentOrReceived! , 1, unsigned: true
t.integer :SentOrReceived!, 1, [0], unsigned: true
t.integer :SequenceType! , 1, [0], unsigned: true
t.integer :ServerId! , unsigned: true
t.integer :ServerPort!
t.integer :ServerPortIncoming!
t.integer :ServiceCode!
t.integer :ServiceCode! , 1
t.integer :ServiceType! , 1
t.integer :SessionId!
t.integer :SetProspective!, 1
t.integer :SetupCDS! , 1
t.integer :Severity! , 1
t.integer :SheetType!
t.integer :ShortCodeOptIn! , 1
t.integer :ShowAccount! , 1
t.integer :ShowAppts! , 1
t.integer :ShowCDS! , 1
t.integer :ShowCompleted!, 1
t.integer :ShowDemographics! , 1
t.integer :ShowDiscount! , 1
t.integer :ShowFees! , 1
t.integer :ShowInfobutton! , 1
t.integer :ShowIns! , 1
t.integer :ShowInTerminal! , 1
t.integer :ShowMaxDed! , 1
t.integer :ShowPreviousDate!, 1
t.integer :ShowProcNotes! , 1
t.integer :ShowSubTotals!, 1
t.integer :ShowTotals! , 1
t.integer :ShowTwainUI! , 1
t.integer :SigElementType!, 1, unsigned: true
t.integer :SigIsTopaz , 1, [0], unsigned: true
t.integer :SigIsTopaz! , 1
t.integer :SigIsTopaz! , 1, unsigned: true
t.integer :SigOnFile! , 1, [1], unsigned: true
t.integer :SmsSendStatus! , 1
t.integer :SmsStatus! , 1
t.integer :SnapshotTrigger!, 1
t.integer :SnomedType , 1
t.integer :Source! , 1
t.integer :SpecialProgramCode! , 1
t.integer :SpO2 , 2
t.integer :StackBehavLR! , 1
t.integer :StackBehavUR! , 1
t.integer :StartTime!
t.integer :Status! , 1
t.integer :Status! , 1, [0], unsigned: true
t.integer :Status2!
t.integer :StatusIsActive! , 1
t.integer :StmtLinkType!, 1
t.integer :StopTime!
t.integer :SubStatus! , 1
t.integer :SubstOnlyIf!
t.integer :SuppIDType!, 1, [0], unsigned: true
t.integer :SupportedCarrierFlags!, 1
t.integer :SynchIcon! , 1, unsigned: true
t.integer :TabOrder!
t.integer :TabOrderMobile!
t.integer :TaskDock! , [0]
t.integer :TaskListStatus! , 1
t.integer :TaskStatus! , 1
t.integer :TaskStatus! , 1, [0], unsigned: true
t.integer :TaskX! , [900]
t.integer :TaskY! , [625]
t.integer :Temp , 2
t.integer :TemplateType!, 1
t.integer :TerminalStatus!, 1, unsigned: true
t.integer :TextAlign! , 1
t.integer :TimeLocked! , 1
t.integer :TimePeriod! , 1, [0], unsigned: true
t.integer :TobaccoCessationDesire!, 1, unsigned: true
t.integer :TokenType! , 1
t.integer :ToolBar! , 2, [0], unsigned: true
t.integer :ToothValue! , 2
t.integer :TPStatus! , 1
t.integer :TPType! , 1
t.integer :TransactionStatus! , 1
t.integer :TransSetNum!
t.integer :TransType! , 1
t.integer :TreatArea! , 1, [0], unsigned: true
t.integer :TrustedEtransFlags! , 1
t.integer :TxtMsgOk! , 1
t.integer :Type! , 1
t.integer :TypeCur! , 1
t.integer :TypePromotion! , 1
t.integer :UnitQty!
t.integer :UnitQtyType! , 1
t.integer :UnitsRequired! , 1
t.integer :UpdateBlocked!, 1
t.integer :Urgency! , 1
t.integer :Urgency! , 1, [0]
t.integer :UseAltCode! , 1, [0], unsigned: true
t.integer :UseBillAddrOnClaims! , 1
t.integer :UseDefaultCov! , 1, [0], unsigned: true
t.integer :UseDefaultFee! , 1, [0], unsigned: true
t.integer :UsePrepay! , 1
t.integer :UserNum!
t.integer :UsesServerVersion! , 1
t.integer :UseSSL! , 1
t.integer :UsingTIN! , 1, [0], unsigned: true
t.integer :VacShareOk! , 1
t.integer :ValCodeSystem! , 1
t.integer :ValType! , 1
t.integer :VerifyType! , 1
t.integer :VitalCDS! , 1
t.integer :VotesAllotted!
t.integer :WaitingRmName! , 1
t.integer :WebServiceIsEcw! , 1
t.integer :Width!
t.integer :WidthOpMinimum! , 2, unsigned: true
t.integer :WindowingMax!
t.integer :WindowingMin!
t.integer :Xpos!
t.integer :XPos!
t.integer :XrayFreqLimit!
t.integer :YearValue!
t.integer :Ypos!
t.integer :YPos!
t.integer :Zoom! , [0]
t.string :Abbr
t.string :Abbr!
t.string :Abbr! , 50
t.string :AbbrDesc , 50, [""]
t.string :Abbrev , [""]
t.string :Abbrev , 20, [""]
t.string :Abbreviation , [""]
t.string :AbnormalFlag!
t.string :AbnormalFlags!
t.string :AccessToken! , 2000
t.string :AccidentRelated , 1, [""]
t.string :AccidentST , 2, [""]
t.string :AccountId! , 25
t.string :AccountToken!
t.string :AckCode
t.string :ActionCode!
t.string :ActualFileName
t.string :ActualFileName , [""]
t.string :Addr1 , 48
t.string :Addr2 , 32
t.string :Address
t.string :Address , [""]
t.string :Address , 100, [""]
t.string :Address!
t.string :Address! , 100
t.string :Address2
t.string :Address2 , [""]
t.string :Address2 , 100, [""]
t.string :Address2, [""]
t.string :Address2! , 100
t.string :AdmissionSourceCode!
t.string :AdmissionTypeCode!
t.string :AggEmailTemplateType!
t.string :Alias!
t.string :AlternateCode1 , 15, [""]
t.string :AnalysisDateTime!
t.string :AnesthClose , 32
t.string :Anesthetist , 32
t.string :AnesthHowSupplied!, 20
t.string :AnesthMedName , 30
t.string :AnesthMedName , 32
t.string :AnesthOpen , 32
t.string :APIKeyHash!
t.string :AppointmentTypeName!
t.string :ApprCode!
t.string :ApprovalCode!
t.string :ApptModNote , [""]
t.string :ASA , 3
t.string :ASA_EModifier , 1
t.string :Asst , 32
t.string :AtoZpath
t.string :AtoZpath!
t.string :AttachedFlags
t.string :AttachmentGuid! , 50
t.string :AttachmentID
t.string :AutoNoteName, 50
t.string :BackupPassCode! , 32
t.string :BankBranch , 25, [""]
t.string :BankNumber , [""]
t.string :BarCodeOrID!
t.string :Batch! , 25
t.string :BatchNum!
t.string :BillingAddress!
t.string :BillingAddress2!
t.string :BillingCity!
t.string :BillingNote!
t.string :BillingState!
t.string :BillingZip!
t.string :BlockWirelessNumber!
t.string :BlueCrossID , 25, [""]
t.string :BMIExamCode! , 30
t.string :BusinessName!
t.string :ButtonText , [""]
t.string :ButtonText!
t.string :CanadaTransRefNum!
t.string :CanadianDiagnosticCode!
t.string :CanadianInstitutionCode!
t.string :CanadianIsInitialLower! , 5
t.string :CanadianIsInitialUpper! , 5
t.string :CanadianMaterialsForwarded! , 10
t.string :CanadianOfficeNum , 100, [""]
t.string :CanadianPlanFlag! , 5
t.string :CanadianReferralProviderNum! , 20
t.string :CanadianTransactionPrefix!
t.string :CanadianTypeCodes! , 20
t.string :CardBrand!
t.string :CardBrandShort!
t.string :CardCodeResponse!
t.string :CardType!
t.string :CareCreditMerchantId!, 20
t.string :CarrierName , [""]
t.string :CarrierName!
t.string :CarrierNameRaw! , 60
t.string :CatalogNumber
t.string :CCEntry!
t.string :CCNumberMasked
t.string :CCType!
t.string :CDAnetVersion , 100, [""]
t.string :CdcrecCode!
t.string :CellType!
t.string :ChannelEndpoint!
t.string :ChannelHeader!
t.string :ChannelPayLoad!
t.string :ChargeFrequency! , 150
t.string :ChartNumber , [""]
t.string :ChartNumber , 20, [""]
t.string :CheckNum , 25, [""]
t.string :CheckNumber , [""]
t.string :Circulator , 32
t.string :City
t.string :City , [""]
t.string :City , 100, [""]
t.string :City , 48
t.string :City!
t.string :City! , 100
t.string :ClaimAdjReasonCodes!
t.string :ClaimField!, 5
t.string :ClaimIdentifier!
t.string :ClaimNote , 400
t.string :ClaimNote , 80, [""]
t.string :ClaimStatus , 1, [""]
t.string :ClaimType , [""]
t.string :ClaimType!
t.string :ClaimType! , 10
t.string :ClassType!
t.string :ClerkID!
t.string :ClientAcctNumber!
t.string :ClientId! , 25
t.string :ClientProgram , [""]
t.string :ClinicalInfo!
t.string :ClinicalInfoCodeSystemName!
t.string :ClinicalInfoCodeSystemNameAlt!
t.string :ClinicalInfoID!
t.string :ClinicalInfoIDAlt!
t.string :ClinicalInfoText!
t.string :ClinicalInfoTextAlt!
t.string :ClinicalInfoTextOriginal!
t.string :ClinicDesc!
t.string :ClinicId!
t.string :ClinicKey!
t.string :ClinicNums!
t.string :ClockStatus , [""]
t.string :Code0 , 2
t.string :Code1 , 2
t.string :Code10 , 2
t.string :Code2 , 2
t.string :Code3 , 2
t.string :Code4 , 2
t.string :Code5 , 2
t.string :Code6 , 2
t.string :Code7 , 2
t.string :Code8 , 2
t.string :Code9 , 2
t.string :CodeEnd , 15
t.string :CodeMod1 , 2
t.string :CodeMod2 , 2
t.string :CodeMod3 , 2
t.string :CodeMod4 , 2
t.string :CodeRange!
t.string :CodeSent , 15, [""]
t.string :CodeStart , 15
t.string :CodeStr! , 4000
t.string :CodeSystem! , 30
t.string :CodeSystemEvent! , 30
t.string :CodeSystemName!
t.string :CodeSystemReason!, 30
t.string :CodeSystemResult! , 30
t.string :CodeValue!
t.string :CodeValue! , 30
t.string :CodeValueEvent! , 30
t.string :CodeValueReason! , 30
t.string :CodeValueResult! , 30
t.string :CollectionDateTimeEnd!
t.string :CollectionDateTimeStart!
t.string :ColName!
t.string :CommandLine , [""]
t.string :Comments
t.string :CompareString!
t.string :CompName , 100, [""]
t.string :CompName!
t.string :Component!
t.string :ComponentSeparator! , 5
t.string :ComputerName , [""]
t.string :ComputerName!
t.string :ComputerName! , 64
t.string :ComputerName! , collation: "utf8mb3_general_ci"
t.string :ComputerOS!
t.string :ConditionType! , 50
t.string :ConditionValue!
t.string :ConfirmCode!
t.string :ConnectionStatus!
t.string :Contact , 32
t.string :ContactValue!
t.string :ControlId! , 9
t.string :ControlLabel
t.string :ControlType , 50
t.string :CopyToAssigningAuthorityIDType!
t.string :CopyToAssigningAuthorityNamespaceID!
t.string :CopyToAssigningAuthorityUniversalID!
t.string :CopyToFName!
t.string :CopyToID!
t.string :CopyToIdentifierTypeCode!
t.string :CopyToLName!
t.string :CopyToMiddleNames!
t.string :CopyToNameTypeCode!
t.string :CopyToPrefix!
t.string :CopyToSuffix!
t.string :Country!
t.string :CountryCode!
t.string :County , [""]
t.string :County!
t.string :CountyCode , [""]
t.string :CountyName!, [""]
t.string :CourseID, [""]
t.string :CptCode!
t.string :CreditCardNum!
t.string :CreditType , 1, [""]
t.string :Criteria!
t.string :CriterionDescript!
t.string :CriterionValue!
t.string :Culture , [""]
t.string :CustApiKey!
t.string :CustErr!
t.string :CustErrorText!
t.string :CustomerId
t.string :CustomerKey!
t.string :CustomID!
t.string :CvxCode!
t.string :CVXCode!
t.string :DashboardGroupName!
t.string :DashboardTabName!
t.string :DatabaseName!
t.string :DataFileName, [""]
t.string :DataType!
t.string :DEANum , 15, [""]
t.string :DEANum! , 15
t.string :DEASchedule , 3
t.string :Descript
t.string :Descript , [""]
t.string :Descript , 50
t.string :Descript, [""]
t.string :Description
t.string :Description , [""]
t.string :Description , 50, [""]
t.string :Description, [""]
t.string :Description!
t.string :Description! , 2000
t.string :Description! , 50
t.string :Description!, 4000
t.string :DescriptionOverride!
t.string :DescriptionShort!
t.string :DescriptOverride!
t.string :DeviceName!
t.string :DevName!
t.string :DiagnosticCode , [""]
t.string :DiagnosticCode2!
t.string :DiagnosticCode3!
t.string :DiagnosticCode4!
t.string :DirectorFName!
t.string :DirectorLName!
t.string :DirectorTitle!
t.string :DirectXFormat , [""]
t.string :DiseaseName, [""]
t.string :Disp , [""]
t.string :DisplayedFileName
t.string :DisplayedFileName, [""]
t.string :DisplayedFileName!
t.string :DisplayName!
t.string :DisplayNote! , 4000
t.string :DispUnitDesc!
t.string :DivisionNo , [""]
t.string :DomainUser!
t.string :DosageCode!
t.string :DoseTimeStamp , 32
t.string :DrawText!
t.string :Drug , [""]
t.string :DrugNDC!
t.string :Dx!
t.string :EclaimCode , 100
t.string :EClipboardClinicalPin , 128
t.string :EcwID!
t.string :ElectID , [""]
t.string :ElectPassword!
t.string :ElectUserName!
t.string :ElementDesc , [""]
t.string :EMail , [""]
t.string :Email , 100, [""]
t.string :Email!
t.string :EmailAddress!
t.string :EmailAliasOverride!
t.string :EmailPassword!
t.string :EmailPersonal!
t.string :EmailResponse!
t.string :EmailSubject!
t.string :EmailTemplateType!
t.string :EmailUsername!
t.string :EmailWork!
t.string :EmploymentNote , [""]
t.string :EmpName , [""]
t.string :EndPointUrl!
t.string :EntryMethod!
t.string :ErxGuid!
t.string :ErxGuid! , 40
t.string :ErxPharmacyInfo!
t.string :EscapeCharacter! , 5
t.string :EscortCellNum , 13
t.string :EscortName , 32
t.string :EscortRel , 16
t.string :EServiceCode!
t.string :EstimateNote!
t.string :EvalTitle!
t.string :EventType!
t.string :ExpDate!
t.string :ExpDateToken!
t.string :Expiration!
t.string :Extension!
t.string :ExternalGUID!
t.string :ExternalId!
t.string :ExternalSource!
t.string :FacilityID!
t.string :FacilityName!
t.string :FailReason!
t.string :Fax
t.string :Fax , [""]
t.string :Fax , 13
t.string :Fax! , 50
t.string :FieldName
t.string :FieldName , [""]
t.string :FieldName!
t.string :FieldName!, 50
t.string :FieldSeparator! , 5
t.string :FileName , [""]
t.string :FileName!
t.string :FilePath!
t.string :FilledCity!
t.string :FilledST!
t.string :FillerOrderNamespace!
t.string :FillerOrderNum!
t.string :FillerOrderUniversalID!
t.string :FillerOrderUniversalIDType!
t.string :FKeyType!
t.string :Flags!
t.string :FName , [""]
t.string :FName , 100, [""]
t.string :FName!
t.string :FontName
t.string :FontName , [""]
t.string :FormatString , [""]
t.string :FrequencyToRun! , 50
t.string :FromCode , 15, [""], collation: "utf8mb3_bin"
t.string :FromUser!
t.string :GenderIdentity!
t.string :GenderIdentityNote!
t.string :GradeSchool!
t.string :GradeShowing!
t.string :GroupName , 50, [""]
t.string :GroupNum , 25
t.string :GroupNum! , 25
t.string :GS03
t.string :GuidBatch!
t.string :GuidMessage!
t.string :HasIns , [""]
t.string :HcpcsCode!
t.string :Heading , [""]
t.string :HeightExamCode! , 30
t.string :HeirarchicalCode!
t.string :HL7FieldSubfieldID!
t.string :HL7OID!
t.string :HL7Server!
t.string :HL7ServiceName!
t.string :HmPhone , 30, [""]
t.string :HostedUrl
t.string :Icd10Code!
t.string :ICD9Code!
t.string :ICEName!
t.string :ICEPhone! , 30
t.string :IDExternal!
t.string :IDNumber , [""]
t.string :IDRoot!
t.string :IDType!
t.string :ImageFileName, [""]
t.string :ImageFolder , 100, [""]
t.string :InactiveCode!
t.string :IncomingFolder!
t.string :IncomingPort!
t.string :Instructions!
t.string :InternalName
t.string :InternalName!
t.string :InternalType!
t.string :InternalTypeVersion! , 50
t.string :InvoiceNum!
t.string :InvoiceNum! , 20
t.string :IpAddress! , 50
t.string :ISA02! , 10
t.string :ISA04! , 10
t.string :ISA05
t.string :ISA07
t.string :ISA08
t.string :ISA15
t.string :ISA16! , 2
t.string :IsActive!
t.string :IsCode!
t.string :IsProsthesis , 1, [""]
t.string :ItemName , [""]
t.string :ItemNum!
t.string :ItemValue , [""]
t.string :ItemValue! , 4000
t.string :IVF , 20
t.string :IVSite , 20
t.string :KeyValue!
t.string :KeyWords!
t.string :LabNameAddress!
t.string :LabResultCompare!
t.string :LabResultID!
t.string :LabResultName!
t.string :Language , 100, [""]
t.string :Language!
t.string :LaymanTerm , [""]
t.string :ListName!
t.string :LName , [""]
t.string :LName , 100, [""]
t.string :LName!
t.string :LogGuid , 36
t.string :LogGuid! , 36
t.string :LogHash!
t.string :LoginID , [""]
t.string :LoincCode!
t.string :LotNumber!
t.string :ManufacturerCode!, 20
t.string :ManufacturerName!
t.string :MaskedAcctNum!
t.string :MedDescript!
t.string :MedicaidID , 20, [""]
t.string :MedicaidState! , 50
t.string :MedicalCode , 15, [""], collation: "utf8mb3_bin"
t.string :MedicalDirectorAssigningAuthorityIDType!
t.string :MedicalDirectorAssigningAuthorityNamespaceID!
t.string :MedicalDirectorAssigningAuthorityUniversalID!
t.string :MedicalDirectorFName!
t.string :MedicalDirectorID!
t.string :MedicalDirectorIdentifierTypeCode!
t.string :MedicalDirectorLName!
t.string :MedicalDirectorMiddleNames!
t.string :MedicalDirectorNameTypeCode!
t.string :MedicalDirectorPrefix!
t.string :MedicalDirectorSuffix!
t.string :MedLabAccountNum! , 16
t.string :MedName , [""]
t.string :MedUrgNote , [""]
t.string :Memo!
t.string :MerchantNumber! , 20
t.string :Message!
t.string :MessageID , 50
t.string :MessageStructure!
t.string :MessageType!
t.string :MethodCode!
t.string :MethodName!
t.string :MethodType!
t.string :MI , 100, [""]
t.string :MiddleI , [""]
t.string :MiddleI , 100, [""]
t.string :MmslCode!
t.string :MName , 100, [""]
t.string :MobilePhoneNumber!
t.string :MobileWebPin!
t.string :ModelYear , 2
t.string :MoreInfo!
t.string :MotherMaidenFname!
t.string :MotherMaidenLname!
t.string :MsgRefID!
t.string :MsgType!
t.string :MySqlPassword!
t.string :MySqlUser!
t.string :Name
t.string :NameInternal
t.string :NameItem!
t.string :NameLongCommon!
t.string :NameShort!
t.string :NameShowing
t.string :NationalProvID
t.string :NationalProvID , [""]
t.string :NationalProviderID!
t.string :NewValue!
t.string :Note , [""]
t.string :Note , 4000
t.string :Note!
t.string :Note! , 4000
t.string :Notes
t.string :Notes , [""]
t.string :NotificationMsg!
t.string :NPOTime , 5
t.string :ObservationDateTime!
t.string :ObservationDateTimeEnd!
t.string :ObservationDateTimeStart!
t.string :ObservationIdentifierCodeSystemName!
t.string :ObservationIdentifierCodeSystemNameAlt!
t.string :ObservationIdentifierID!
t.string :ObservationIdentifierIDAlt!
t.string :ObservationIdentifierSub!
t.string :ObservationIdentifierText!
t.string :ObservationIdentifierTextAlt!
t.string :ObservationIdentifierTextOriginal!
t.string :ObservationResultStatus!
t.string :ObservationValueCodedElementCodeSystemName!
t.string :ObservationValueCodedElementCodeSystemNameAlt!
t.string :ObservationValueCodedElementID!
t.string :ObservationValueCodedElementIDAlt!
t.string :ObservationValueCodedElementText!
t.string :ObservationValueCodedElementTextAlt!
t.string :ObservationValueCodedElementTextOriginal!
t.string :ObservationValueComparator!
t.string :ObservationValueDateTime!
t.string :ObservationValueSeparatorOrSuffix!
t.string :ObservationValueText!
t.string :ObsID!
t.string :ObsIDSub!
t.string :ObsLoinc!
t.string :ObsLoincText!
t.string :ObsRange!
t.string :ObsSubType!
t.string :ObsTestDescript!
t.string :ObsTestID!
t.string :ObsTestLoinc!
t.string :ObsTestLoincText!
t.string :ObsText!
t.string :ObsUnits!
t.string :ObsValue!
t.string :OdPassword!
t.string :OdUser!
t.string :OldCode! , 15, [""], collation: "utf8mb3_bin"
t.string :OldValue!
t.string :OpName , [""]
t.string :OrderControlCode!
t.string :OrderId!
t.string :OrderingProvFName!
t.string :OrderingProviderAssigningAuthorityIDType!
t.string :OrderingProviderAssigningAuthorityNamespaceID!
t.string :OrderingProviderAssigningAuthorityUniversalID!
t.string :OrderingProviderFName!
t.string :OrderingProviderID!
t.string :OrderingProviderIdentifierTypeCode!
t.string :OrderingProviderLName!
t.string :OrderingProviderMiddleNames!
t.string :OrderingProviderNameTypeCode!
t.string :OrderingProviderPrefix!
t.string :OrderingProviderSuffix!
t.string :OrderingProvLName!
t.string :OrderingProvLocalID!
t.string :OrderingProvNPI!
t.string :OrderObs!
t.string :OriginalDbName, 4000, [""]
t.string :OrigRefNum!
t.string :OTK!
t.string :OutgoingFolder!
t.string :OutgoingIpPort!
t.string :OverallGradeShowing!
t.string :PageTitle!
t.string :PaintText!
t.string :ParentFillerOrderNamespace!
t.string :ParentFillerOrderNum!
t.string :ParentFillerOrderUniversalID!
t.string :ParentFillerOrderUniversalIDType!
t.string :ParentObservationCodeSystemName!
t.string :ParentObservationCodeSystemNameAlt!
t.string :ParentObservationID!
t.string :ParentObservationIDAlt!
t.string :ParentObservationSubID!
t.string :ParentObservationText!
t.string :ParentObservationTextAlt!
t.string :ParentObservationTextOriginal!
t.string :ParentObsID!
t.string :ParentObsTestID!
t.string :ParentPlacerOrderNamespace!
t.string :ParentPlacerOrderNum!
t.string :ParentPlacerOrderUniversalID!
t.string :ParentPlacerOrderUniversalIDType!
t.string :Password
t.string :Password , [""]
t.string :Password!
t.string :PasswordResetCode!
t.string :PatAccountNum!
t.string :PatAge!
t.string :Path , [""]
t.string :PathExportCCD!
t.string :PatID , 100, [""]
t.string :PatIDAlt!
t.string :PatIDLab!
t.string :PatientName! , 100
t.string :PatientNameRaw! , 133
t.string :PatientStatusCode!
t.string :Pattern , [""]
t.string :Pattern!
t.string :PatternSecondary!
t.string :PayConnectToken!
t.string :PayerName! , 60
t.string :PaymentMethodCode!, 3
t.string :PaymentToken!
t.string :PayNote!
t.string :PayorID , [""]
t.string :PayrollID!
t.string :PaySimpleToken!
t.string :PayToAddress!
t.string :PayToAddress2!
t.string :PayToCity!
t.string :PayToken!
t.string :PayToState!
t.string :PayToZip!
t.string :PerformingOrganizationAddressAddressType!
t.string :PerformingOrganizationAddressCity!
t.string :PerformingOrganizationAddressCountryCode!
t.string :PerformingOrganizationAddressCountyOrParishCode!
t.string :PerformingOrganizationAddressOtherDesignation!
t.string :PerformingOrganizationAddressStateOrProvince!
t.string :PerformingOrganizationAddressStreet!
t.string :PerformingOrganizationAddressZipOrPostalCode!
t.string :PerformingOrganizationIdentifier!
t.string :PerformingOrganizationIdentifierTypeCode!
t.string :PerformingOrganizationName!
t.string :PerformingOrganizationNameAssigningAuthorityNamespaceId!
t.string :PerformingOrganizationNameAssigningAuthorityUniversalId!
t.string :PerformingOrganizationNameAssigningAuthorityUniversalIdType!
t.string :PersonName!
t.string :PharmID
t.string :Phone
t.string :Phone , [""]
t.string :Phone , 13
t.string :Phone!
t.string :Phone2 , 30, [""]
t.string :PhoneExt , 6
t.string :PhoneNumber!
t.string :PhoneNumberDigits!, 30
t.string :PhoneNumberVal
t.string :PickList, [""]
t.string :PlacerGroupNamespace!
t.string :PlacerGroupNum!
t.string :PlacerGroupUniversalID!
t.string :PlacerGroupUniversalIDType!
t.string :PlacerOrderNamespace!
t.string :PlacerOrderNum!
t.string :PlacerOrderUniversalID!
t.string :PlacerOrderUniversalIDType!
t.string :PlanType , 1, [""]
t.string :PluginDllName!
t.string :Pop3ServerIncoming!
t.string :PracticeName!
t.string :PreAuthString , 40, [""]
t.string :Preferred , 100, [""]
t.string :PreferredName! , 100
t.string :PrefName!
t.string :PrefName! , [""]
t.string :PrinterName , [""]
t.string :PriorAuthorizationNumber!
t.string :ProcAbbr! , 50
t.string :ProcCode , 15
t.string :ProcCode! , 15, [""], collation: "utf8mb3_bin"
t.string :ProcDescript , [""]
t.string :ProcDescript!
t.string :Procedures
t.string :ProcessingStatus!
t.string :ProcessorResponse!
t.string :ProcTime
t.string :ProcTime , 24, [""]
t.string :ProgDesc , 100, [""]
t.string :ProgName , 100, [""]
t.string :Prognosis!
t.string :ProgramVersion!
t.string :PromotionName!
t.string :PropertyDesc , [""]
t.string :PropertyDesc , [""], collation: "utf8mb3_general_ci"
t.string :PropertyObserved!
t.string :Prosthesis , 1, [""]
t.string :ProvBarText! , 60
t.string :ProviderTypes, [""]
t.string :ProvKey!
t.string :ProvName!
t.string :QueryString! , 1000
t.string :RadioButtonGroup!
t.string :RadioButtonValue!
t.string :RawMsgText! , 1000
t.string :Reaction!
t.string :Reason!
t.string :ReasonUnderPaid , [""]
t.string :RecipientAddress!
t.string :referenceRange!
t.string :ReferenceRange!
t.string :Refills , 30, [""]
t.string :RefNumber!
t.string :RefNumString , 40, [""]
t.string :RegKey , 4000
t.string :Remarks , [""]
t.string :ReminderGroupId! , 20
t.string :RepetitionSeparator! , 5
t.string :ReportableName
t.string :ResellerPassword!
t.string :ResourceUrl!
t.string :ResponseDescription!
t.string :ResponsePath , [""]
t.string :Result!
t.string :ResultCode!
t.string :ResultDateTime!
t.string :ResultStatus!
t.string :RevCode , 45
t.string :RevenueCodeDefault!
t.string :rootExternal!
t.string :RuleDesc , [""]
t.string :RxBIN!
t.string :RxCui!
t.string :Salutation , 100, [""]
t.string :ScaleType!
t.string :ScaleValue!
t.string :SchedNote!
t.string :ScheduledAction!, 50
t.string :SchoolName!
t.string :SecurityHash!
t.string :SegmentName!
t.string :SenderAddress!
t.string :SenderName
t.string :SenderTelephone
t.string :SenderTIN
t.string :SendingApp!
t.string :SendingFacility!
t.string :SendOrder!
t.string :SensorType , ["D"]
t.string :SeparatorData! , 2
t.string :SeparatorSegment! , 2
t.string :SerialNumber
t.string :ServerName!
t.string :ServiceId!
t.string :ServiceName!
t.string :ServiceType!
t.string :ServiceURI!
t.string :SessionName!
t.string :SessionTokenHash!
t.string :SexualOrientation!
t.string :SexualOrientationNote!
t.string :SftpInSocket!
t.string :SftpPassword!
t.string :SftpUsername!
t.string :ShortGUID!
t.string :ShortGuid!
t.string :ShortGUID! , 30
t.string :ShortURL!
t.string :Sig , [""]
t.string :SignaturePracticeText!
t.string :SignatureText!
t.string :SigText , [""]
t.string :SigText!
t.string :SlaveMonitor!
t.string :SmokingSnoMed!
t.string :SmokingSnoMed! , 32
t.string :SmsPhoneNumber!
t.string :SMTPserver!
t.string :SnomedBodySite!
t.string :SnomedCode!
t.string :SnomedEducation!
t.string :SnomedProblemType!
t.string :SnomedReaction!
t.string :SopCode!
t.string :SpecimenActionCode!
t.string :SpecimenCondition!
t.string :SpecimenConditionCodeSystemName!
t.string :SpecimenConditionCodeSystemNameAlt!
t.string :SpecimenConditionID!
t.string :SpecimenConditionIDAlt!
t.string :SpecimenConditionText!
t.string :SpecimenConditionTextAlt!
t.string :SpecimenConditionTextOriginal!
t.string :SpecimenDescript!
t.string :SpecimenID!
t.string :SpecimenIDAlt!
t.string :SpecimenIDFiller!
t.string :SpecimenRejectReasonCodeSystemName!
t.string :SpecimenRejectReasonCodeSystemNameAlt!
t.string :SpecimenRejectReasonID!
t.string :SpecimenRejectReasonIDAlt!
t.string :SpecimenRejectReasonText!
t.string :SpecimenRejectReasonTextAlt!
t.string :SpecimenRejectReasonTextOriginal!
t.string :SpecimenSource!
t.string :SpecimenTypeCodeSystemName!
t.string :SpecimenTypeCodeSystemNameAlt!
t.string :SpecimenTypeID!
t.string :SpecimenTypeIDAlt!
t.string :SpecimenTypeText!
t.string :SpecimenTypeTextAlt!
t.string :SpecimenTypeTextOriginal!
t.string :SSN , 100, [""]
t.string :SSN , 12, [""]
t.string :SSN , 20, [""]
t.string :SSN , 9, [""]
t.string :ST , 2, [""]
t.string :State
t.string :State , [""]
t.string :State , 100, [""]
t.string :State , 20
t.string :State , 20, [""]
t.string :State!
t.string :State! , 100
t.string :StateLicense , 15, [""]
t.string :StateLicense! , 50
t.string :StatementShortURL!, 50
t.string :StatementType! , 50
t.string :StatementURL!
t.string :StateRxID!
t.string :StateWhereLicensed! , 15
t.string :StateWhereLicensed! , 50
t.string :StatusOfCode!
t.string :StoreName
t.string :StudentStatus , 1, [""]
t.string :SubcomponentSeparator!, 5
t.string :SubscriberID!
t.string :SubstitutionCode , 25
t.string :SubstitutionCode!, 25
t.string :Suffix , 100, [""]
t.string :Suffix, 100, [""]
t.string :SupplierIDNum!, 11
t.string :SupplierName!
t.string :Surf , [""]
t.string :Surf , 10, [""]
t.string :Surf!
t.string :SurgClose , 32
t.string :Surgeon , 32
t.string :SurgOpen , 32
t.string :SystemMeasured!
t.string :TableId!
t.string :TabName!
t.string :TaxCode! , 16
t.string :TaxonomyCodeOverride!
t.string :Telephone , 10, [""]
t.string :TemplateEmailSubj! , 100
t.string :TemplateName, [""]
t.string :TemplateName!
t.string :TemplateType!
t.string :TestID!
t.string :TestName!
t.string :TimeAspct!
t.string :TimePattern
t.string :TimePatternOverride!
t.string :TimeZone! , 75
t.string :TIN!
t.string :Title , [""]
t.string :Title , 15
t.string :ToCode , 15, [""], collation: "utf8mb3_bin"
t.string :ToothNum , 2, [""]
t.string :ToothNum! , 10
t.string :ToothNumbers , [""]
t.string :ToothNumbers!
t.string :ToothNumTP , [""]
t.string :ToothRange , 100, [""]
t.string :ToothRange!
t.string :TotalVolume!
t.string :ToUser!
t.string :TQ1DateTimeEnd!
t.string :TQ1DateTimeStart!
t.string :TrackingType!
t.string :TransactionID!
t.string :TransactionType!
t.string :TranSetId835!
t.string :TransRefNum! , 50
t.string :TransType!
t.string :TrojanID , 100, [""]
t.string :TrophyFolder , [""]
t.string :TwainName!
t.string :UcumCode!
t.string :UiEventType!
t.string :UnearnedTypes! , 4000
t.string :UniformBillType!
t.string :UniiCode!
t.string :UniqueID , [""]
t.string :UniqueID!
t.string :UnitIdentifier!, 20
t.string :UnitsCodeSystemName!
t.string :UnitsCodeSystemNameAlt!
t.string :UnitsID!
t.string :UnitsIDAlt!
t.string :UnitsText!
t.string :UnitsTextAlt!
t.string :UnitsTextOriginal!
t.string :UnitsUCUM!
t.string :UnitText!
t.string :UserId!
t.string :UserName
t.string :UserName , [""]
t.string :UserName!
t.string :UsiCodeSystemName!
t.string :UsiCodeSystemNameAlt!
t.string :UsiID!
t.string :UsiIDAlt!
t.string :UsiText!
t.string :UsiTextAlt!
t.string :UsiTextOriginal!
t.string :VaccineName!
t.string :ValCode! , 2
t.string :ValCodeSystem!
t.string :ValReported!
t.string :ValueEntered!
t.string :ValueType!
t.string :VersionAvail!
t.string :VersionCur!
t.string :VersionIDs!
t.string :VideoRectangle!
t.string :VSMName , 20
t.string :VSMSerNum , 20
t.string :VSMSerNum , 32
t.string :VSTimeStamp , 32
t.string :Ward , [""]
t.string :WatchTable!
t.string :WebSchedImageLocation!
t.string :WebSite , 48
t.string :WebToken!
t.string :WeightCode!
t.string :WeightExamCode! , 30
t.string :WikiPageLink!
t.string :WirelessPhone , 30, [""]
t.string :WirelessPhone!
t.string :WkPhone , [""]
t.string :WkPhone , 30, [""]
t.string :WordText!
t.string :Workstation!
t.string :XChargeToken
t.string :XWebResponseCode!
t.string :Zip
t.string :Zip , [""]
t.string :Zip , 10
t.string :Zip , 10, [""]
t.string :Zip , 100, [""]
t.string :Zip!
t.string :Zip! , 100
t.string :ZipCodeDigits, 20, [""]
t.text :AddrNote
t.text :AdjNote
t.text :AllergyDefNumList!
t.text :Answer
t.text :ApptPhone
t.text :AutographText!
t.text :BankAccountInfo
t.text :BccAddress!
t.text :BenefitNotes!
t.text :Bibliography!
t.text :BodyHTML! , size: :medium
t.text :BodyPlainText! , size: :medium
t.text :BodyText
t.text :BodyText! , size: :long
t.text :ButtonImage
t.text :ButtonImage!
t.text :CcAddress!
t.text :CellSettings!
t.text :ClassType
t.text :Comments
t.text :Comments!
t.text :ContentSummary!, size: :long
t.text :ControlOptions
t.text :CvxList!
t.text :DebugError!
t.text :DefaultClaimNote!
t.text :DefaultForTypes
t.text :DefaultNote
t.text :DefaultTPNote!
t.text :DemographicsList!
t.text :Descript
t.text :Descript!
t.text :Description
t.text :Description!
t.text :DispenseNote!
t.text :Documentation!
t.text :DrawingSegment
t.text :DrawingSegment!
t.text :DunMessage
t.text :EmailBody! , size: :medium
t.text :English
t.text :EnglishComments
t.text :ErrorMsg!
t.text :ErrorNote!
t.text :ErxAccountId!
t.text :ExportPath
t.text :ExternalCopyrightNotice!
t.text :FamFinancial
t.text :FamFinUrgNote
t.text :FieldValue
t.text :FieldValue!
t.text :FileTemplate!
t.text :FixedText!
t.text :FromAddress
t.text :GuidMessageFromMobile!
t.text :GuidMessageToMobile!
t.text :HL7Message , size: :long
t.text :HpfUrl!
t.text :IgnoreSheetDefNums!
t.text :Instructions
t.text :Instructions!
t.text :InternalNote
t.text :InvoiceData, size: :medium
t.text :LabLoincList!
t.text :LastQueryData!
t.text :LastResponseStr!
t.text :ListContent! , size: :medium
t.text :ListHeaders!
t.text :Location!
t.text :LogText
t.text :LogText!
t.text :MainText
t.text :Medical
t.text :MedicalComp
t.text :MedicationNumList!
t.text :Memo
t.text :Message!
t.text :MessageBold
t.text :MessageContent!
t.text :MessageText!, size: :medium
t.text :MsgId
t.text :MsgText , size: :medium
t.text :MsgText!
t.text :MsgText! , size: :medium
t.text :MsgValue!
t.text :NewPatNum!
t.text :Note
t.text :Note!
t.text :Note! , size: :medium
t.text :NoteBold
t.text :NoteLab!
t.text :NotePat!
t.text :Notes
t.text :Notes!
t.text :Npi!
t.text :ObsValue!
t.text :OldPatNum!
t.text :OriginalPIDSegment!
t.text :PageContent! , size: :medium
t.text :PageContentPlainText!, size: :medium
t.text :PatientInstruction!
t.text :PatNote
t.text :PayNote!
t.text :Payors
t.text :PickList!
t.text :PlanNote!
t.text :ProblemDefNumList!
t.text :ProblemIcd10List!
t.text :ProblemIcd9List!
t.text :ProblemSnomedList!
t.text :ProcCodes!
t.text :Procedures!
t.text :ProcsColored!
t.text :PropertyValue
t.text :PropertyValue , collation: "utf8mb3_general_ci"
t.text :ProviderName!
t.text :QueryText! , size: :medium
t.text :RawBase64!
t.text :RawBase64! , size: :long
t.text :RawBase64! , size: :medium
t.text :RawBase64Code! , size: :medium
t.text :RawBase64Data! , size: :medium
t.text :RawBase64Tag! , size: :medium
t.text :RawEmailIn! , size: :long
t.text :RawMessage!
t.text :ReactivationNote!
t.text :Receipt!
t.text :RefreshToken!
t.text :ResponseDescript!
t.text :RxCuiList!
t.text :Service
t.text :Signature
t.text :Signature!
t.text :SignaturePractice!
t.text :Sound , size: :medium
t.text :SourceName!
t.text :Splits
t.text :Status!
t.text :Subject
t.text :Subject!
t.text :SubNote!
t.text :SubscNote!
t.text :Tag!
t.text :TemplateAutoReply!
t.text :TemplateAutoReplyAgg!
t.text :TemplateComeInMessage!
t.text :TemplateEmail!
t.text :TemplateEmailAggPerAppt!
t.text :TemplateEmailAggShared!
t.text :TemplateEmailSubjAggShared!
t.text :TemplateEmailSubject!
t.text :TemplateFailureAutoReply!
t.text :TemplateSMS!
t.text :TemplateSMSAggPerAppt!
t.text :TemplateSMSAggShared!
t.text :TemplateText!
t.text :TextShowing!
t.text :TextValue!
t.text :Thumbnail!
t.text :ToAddress
t.text :TransJson! , size: :medium
t.text :Translation
t.text :Treatment
t.text :UiLabelMobile!
t.text :UiLabelMobileRadioButton!
t.text :ValueString!
t.text :VitalLoincList!
t.text :WebSchedDescript!
t.text :Website
t.time :Adjust!
t.time :AdjustAuto!
t.time :AfterTimeOfDay!
t.time :ApptTimeScrollStart!
t.time :BeforeTimeOfDay!
t.time :MinClockInTime!
t.time :ObservationValueTime! , ["2000-01-01 00:00:00"]
t.time :OnlySchedAfterTime!
t.time :OnlySchedBeforeTime!
t.time :OTimeAuto!
t.time :OTimeHours!
t.time :OTimeHours! , ["2000-01-01 00:00:00"]
t.time :OverHoursPerDay!
t.time :ProcTime!
t.time :ProcTimeEnd!
t.time :PtoHours! , ["2000-01-01 00:00:00"]
t.time :Rate2Auto!
t.time :Rate2Hours!
t.time :Rate3Auto!
t.time :Rate3Hours!
t.time :RegHours! , ["2000-01-01 00:00:00"]
t.time :SchedAfterTime
t.time :SchedBeforeTime
t.time :StartTime! , ["2000-01-01 00:00:00"]
t.time :StopTime! , ["2000-01-01 00:00:00"]
t.timestamp :DateTimeEntry! , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
t.timestamp :DateTStamp! , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
t.timestamp :DateTStamp!, [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
t.timestamp :SecDateTEdit! , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
